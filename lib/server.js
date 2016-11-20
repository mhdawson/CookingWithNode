// Copyright 2014-2016 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
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

  eventSocket = socketio.listen(server);

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
      deviceEntry = {type: 'temp', id: deviceId, temp: temp, timestamp: timestamp};
      probes[deviceId] = deviceEntry;
    } else {
      deviceEntry.temp = temp;
      deviceEntry.timestamp = timestamp; 
    } 
    eventSocket.emit('data', deviceEntry);
  });


  eventSocket.on('connection', function(ioclient) {
    eventSocket.emit('cleanup-all');
    for (var deviceId in probes) {
      if (probes.hasOwnProperty(deviceId)) {
        eventSocket.to(ioclient.id).emit('data', probes[deviceId]);
      }
    }
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
          delete probes.deviceId;
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
