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


Server.handleSupportingPages = function(request, response) {
  if (request.url.indexOf("warnSound") > -1) {
    var soundFile = fs.readFileSync(Server.config.warnSound);
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.end(soundFile);
    return true;
  } else if (request.url.indexOf("targetSound") > -1) {
    var soundFile = fs.readFileSync(Server.config.targetSound);
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.end(soundFile);
    return true;
  } else if (request.url.indexOf('skin.css') > -1) {
    var cssFile = fs.readFileSync(Server.config.skin);
    response.writeHead(200, {'Content-Type': 'text/css'});
    response.end(cssFile);
    return true;
  }
  return false;
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
  var probesHistory = new Object();

  // set defaults
  if (config.warn === undefined) {
    config.warn = 5.5; 
  }

  if (config.warnSound === undefined) {
    config.warnSound = path.join(__dirname,'alert-temp.mp3');
  } 

  if (config.targetSound === undefined) {
    config.targetSound = path.join(__dirname,'target-temp.mp3');
  } 

  if (config.skin === undefined) {
    config.skin = path.join(__dirname,'skin.css');
  }

  var scaleC = config.scaleC;
  if (scaleC === undefined) {
    scaleC = true;
  }

  var toF = function(temp) {
    return Math.ceil((temp*1.8 + 32));
  }

  // if we are in test mode add the initial test probes
  if (config.test) {
    require('./test-probes.js')(probes, probesHistory, scaleC);
  }

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
    var temp = parseFloat(message.substring(message.indexOf(TEMP_PREFIX) + TEMP_PREFIX.length));
    var timestamp = new Date().getTime()/1000;

    var deviceEntry = probes[deviceId];
    if (deviceEntry === undefined) {
      deviceEntry = {type: 'temp', id: deviceId, temp: temp, timestamp: timestamp,
                     meat: 'beef', taste: 'medium', scaleC: scaleC };
      probes[deviceId] = deviceEntry;
      probesHistory[deviceId] = { timestamps: [timestamp], temps: [temp], targets: [] };
    } else {
      deviceEntry.temp = temp;
      deviceEntry.timestamp = timestamp; 
      probesHistory[deviceId].timestamps.push(timestamp);
      probesHistory[deviceId].temps.push(temp);
    } 
    deviceEntry.target = targetTemps[deviceEntry.meat][deviceEntry.taste];
    probesHistory[deviceId].targets.push(deviceEntry.target);

    eventSocket.emit('data', deviceEntry);
  });


  eventSocket.on('connection', function(ioclient) {
    eventSocket.to(ioclient.id).emit('tastes', config.targetTemps);
    eventSocket.to(ioclient.id).emit('cleanup-all');
    eventSocket.to(ioclient.id).emit('chartData', probesHistory);
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
      probes[deviceId].target = newTarget;
      
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
      probes[deviceId].target = newTarget;

      eventSocket.emit('data', probes[deviceId]);
    });

    ioclient.on('scaleC', function(deviceId, scaleC) {
      if (probes[deviceId].scaleC != scaleC) {
        probes[deviceId].scaleC = scaleC;
        eventSocket.emit('data', probes[deviceId]);
      }
    });
  });

  // setup timer to do cleanup and threshold checks
  setInterval(function() {
    for (var deviceId in probes) {
      if (probes.hasOwnProperty(deviceId)) {
        // when a probe is active we'll get updates regularly.  if we
        // don't get data for config.cleanupInterval then assume probe
        // was turned off and stop showing it
        var currentTime = (new Date()).getTime()/1000;
        if ((probes[deviceId].timestamp + config.cleanupInterval) < currentTime) {
          eventSocket.emit('cleanup', probes[deviceId]);
          delete probes[deviceId];
          delete probesHistory[deviceId];
        } else if (probes[deviceId].status !== 'alert') {
          if (probes[deviceId].temp >= probes[deviceId].target) {
            probes[deviceId].status = 'alert';
            eventSocket.emit('data', probes[deviceId]);

            // send out other alerts
            var alertMessage = deviceId + ': at target temp';
            sendSmsMessageVoipms(config, alertMessage);
            sendSmsMessageTwilio(config, alertMessage);
          } else if ((probes[deviceId].status !== 'warn') &&
                     ((probes[deviceId].temp + config.warn) >= probes[deviceId].target)) {
            probes[deviceId].status = 'warn';
            eventSocket.emit('data', probes[deviceId]);

            // send out other alerts
            var warnMessage = deviceId + ': ' + config.warn + ' degrees to go';
            sendSmsMessageVoipms(config, warnMessage);
            sendSmsMessageTwilio(config, warnMessage);
          }
        }
      }
    }
  }, 5 * 1000);
};


var sendSmsMessageTwilio = function(config, info) {
  if (config.twilio != undefined) {
    var twilioClient = new twilio.RestClient(config.twilio.accountSID, config.twilio.accountAuthToken);
    twilioClient.sendMessage({
      to: config.twilio.toNumber,
      from: config.twilio.fromNumber,
      body: info
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
                                                'message=' + encodeURIComponent(info)
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
