// Copyright 2014-2016 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
"use strict";
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs');
const socketio = require('socket.io');
const twilio = require('twilio');
const https = require('https');

///////////////////////////////////////////////
// micro-app framework methods
///////////////////////////////////////////////
const Server = function() {
}


Server.getDefaults = function() {
  return { 'title': 'Cooking with Node' };
}



var replacements;
Server.getTemplateReplacments = function() {
  if (replacements === undefined) {
    const config = Server.config;

    replacements = [{ 'key': '<DASHBOARD_TITLE>', 'value': config.title },
                    { 'key': '<UNIQUE_WINDOW_ID>', 'value': config.title },
                    { 'key': '<PAGE_WIDTH>', 'value': Server.config.windowSize.y },
                    { 'key': '<PAGE_HEIGHT>', 'value': Server.config.windowSize.x }];

  }
  return replacements;
}


Server.startServer = function(server) {
  var config = Server.config;
  var currentTemp = 0;
  var probes = new Object();

  var scaleC = config.scaleC;
  if (scaleC === undefined) {
    scaleC = true;
  }

  var convertTemp = function(scaleC, temp) {
    if (scaleC) {
      return temp;
    } else {
      return (temp*1.8 + 32).toFixed(0);
    }
  }


  probes['test'] = {type: 'temp', id: 'test', temp: convertTemp(scaleC, 25.5), timestamp: (new Date().getTime()/1000), meat: 'beef', taste: 'medium', target: convertTemp(scaleC, 71), scaleC: scaleC};
  probes['test2'] = {type: 'temp', id: 'test2', temp: convertTemp(scaleC, 25.51), timestamp: new Date().getTime()/1000, meat: 'beef', taste: 'medium', target: convertTemp(scaleC, 71), scaleC: scaleC};

  var targetTemps = new Object();
  for (let i = 0; i < config.targetTemps.length; i++) {
    var meatTemps = new Object;
    for (let j = 0; j < config.targetTemps[i].temps.length; j++) {
      var key = Object.keys(config.targetTemps[i].temps[j]);
      meatTemps[key] = config.targetTemps[i].temps[j][key];
    }
    targetTemps[config.targetTemps[i].name] = meatTemps;
  }

  var eventSocket = socketio.listen(server);

  // setup mqtt
  var mqttOptions;
  if (config.mqtt.serverUrl.indexOf('mqtts') > -1) {
    mqttOptions = { key: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.key')),
                    cert: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.cert')),
                    ca: fs.readFileSync(path.join(__dirname, 'mqttclient', '/ca.cert')),
                    checkServerIdentity: function() { return undefined }
    }
  }
  var mqttClient = mqtt.connect(config.mqtt.serverUrl, mqttOptions);

  mqttClient.on('connect',function() {
    mqttClient.subscribe(config.mqtt.mqttTopic);
  });

  mqttClient.on('message', function(topic, message) {
    // decode the message
    message = message.toString();
    const TEMP_PREFIX = 'temp: '
    var deviceId = message.substring(message.indexOf('[') + 1, message.indexOf(']'));
    var temp = parseFloat(message.substring(message.indexOf(TEMP_PREFIX) + TEMP_PREFIX.length)).toFixed(2);
    var timestamp = parseInt(message.substring(message.indexOf('-') + 1, message.indexOf(',')));

    var deviceEntry = probes[deviceId];
    if (deviceEntry === undefined) {
      deviceEntry = {type: 'temp', id: deviceId, temp: convertTemp(deviceEntry.scaleC, temp), timestamp: timestamp,
                     meat: 'beef', taste: 'medium', scaleC: scaleC };
      probes[deviceId] = deviceEntry;
    } else {
      deviceEntry.temp = convertTemp(deviceEntry.scaleC, temp);
      deviceEntry.timestamp = timestamp; 
    } 
    deviceEntry.target = convertTemp(deviceEntry.scaleC, targetTemps[deviceEntry.meat][deviceEntry.taste]);
    eventSocket.emit('data', deviceEntry);
  });


  eventSocket.on('connection', function(ioclient) {
    eventSocket.to(ioclient.id).emit('tastes', config.targetTemps);
    eventSocket.to(ioclient.id).emit('cleanup-all');
    for (var deviceId in probes) {
      if (probes.hasOwnProperty(deviceId)) {
        eventSocket.to(ioclient.id).emit('data', probes[deviceId]);
      }
    }

    ioclient.on('new-meat', function(deviceId, meat) {
      probes[deviceId].meat = meat;
      var newTarget = targetTemps[meat][probes[deviceId].taste];
      if (newTarget === undefined) {
        const taste = Object.keys(targetTemps[meat])[0];
        newTarget = targetTemps[meat][taste];
        probes[deviceId].taste = taste;
      }
      probes[deviceId].target = convertTemp(probes[deviceId].scaleC, newTarget);
      
      eventSocket.emit('data', probes[deviceId]);
    });

    ioclient.on('new-taste', function(deviceId, taste) {
      const meat = probes[deviceId].meat;
      var newTarget = targetTemps[meat][taste];
      if (newTarget === undefined) {
        taste = Object.keys(targetTemps[meat])[0];
        newTarget = targetTemps[meat][taste];
      }
      probes[deviceId].taste = taste;
      probes[deviceId].target = convertTemp(probes[deviceId].scaleC, newTarget);

      eventSocket.emit('data', probes[deviceId]);
    });

    ioclient.on('scaleC', function(deviceId, scaleC) {
      if (probes[deviceId].scaleC != scaleC) {
        probes[deviceId].scaleC = scaleC;
        if (scaleC) {
          probes[deviceId].target = targetTemps[probes[deviceId].meat][probes[deviceId].taste];
          probes[deviceId].temp = ((probes[deviceId].temp - 32)/1.8).toFixed(2);
        } else {
          probes[deviceId].target = (probes[deviceId].target*1.8 + 32).toFixed(0);
          probes[deviceId].temp = (probes[deviceId].temp*1.8 + 32).toFixed(0);
        }
        eventSocket.emit('data', probes[deviceId]);
      }
    });
  });

  // when a probe is active we'll get updates regularly.  if we
  // don't get data for config.cleanupInterval then assume probe
  // was turned off and stop showing it
  setInterval(function() {
    for (var deviceId in probes) {
      if (probes.hasOwnProperty(deviceId)) {
        var currentTime = (new Date()).getTime()/1000;
        if ((probes[deviceId].timestamp + config.cleanupInterval) < currentTime) {
          eventSocket.emit('cleanup', probes[deviceId]);
          delete probes[deviceId];
        }
      }
    }
  }, 15 * 1000);
};


var sendSmsMessageTwilio = function(config, info) {
  if (config.twilio != undefined) {
    var twilioClient = new twilio.RestClient(config.twilio.accountSID, config.twilio.accountAuthToken);
    twilioClient.sendMessage({
      to: config.twilio.toNumber,
      from: config.twilio.fromNumber,
      body: 'Voicemail messages waiting :' + info
    }, function(err, message) {
      if (err) { 
       console.log('Failed to send sms:' + err.message);
      }
    }); 
  }
};


var sendSmsMessageVoipms = function(config, info) {
  if (config.voipms != undefined) {
    var options = { host: 'voip.ms',
                    port: 443,
                    method: 'GET',
                    path: '/api/v1/rest.php?' + 'api_username=' + config.voipms.user + '&' + 
                                                'api_password=' + config.voipms.password + '&' + 
                                                'method=sendSMS' + '&' + 
                                                'did=' + config.voipms.did + '&' + 
                                                'dst=' + config.voipms.dst + '&' + 
                                                'message=' + encodeURIComponent('Voicemail messages waiting:' + info)
                   };
    var request = https.request(options, function(res) {
      if (res.statusCode !== 200) {
        console.log('STATUS:' + res.statusCode);
      }
    }); 
    request.end(); 
  }
}


if (require.main === module) {
  var microAppFramework = require('micro-app-framework');
  microAppFramework(path.join(__dirname), Server);
}


module.exports = Server;
