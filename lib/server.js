// Copyright 2016 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
"use strict";
const fs = require('fs');
const https = require('https');
const mqtt = require('mqtt');
const notify = require('micro-app-notify-client');
const path = require('path');
const socketio = require('socket.io');
const twilio = require('twilio');

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
    const soundFile = fs.readFileSync(Server.config.warnSound);
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.end(soundFile);
    return true;
  } else if (request.url.indexOf("targetSound") > -1) {
    const soundFile = fs.readFileSync(Server.config.targetSound);
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.end(soundFile);
    return true;
  } else if (request.url.indexOf('skin.css') > -1) {
    const cssFile = fs.readFileSync(Server.config.skin);
    response.writeHead(200, {'Content-Type': 'text/css'});
    response.end(cssFile);
    return true;
  }
  return false;
}


let replacements;
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


const toF = function(temp) {
  return Math.ceil((temp*1.8 + 32));
}


const toC = function(temp) {
  return parseFloat(((temp -32)/1.8).toFixed(2));
}


const convertTemp = function(scaleC, temp) {
  if (scaleC) {
    return parseFloat(temp.toFixed(2));
  } else {
    return toF(temp);
  }
}

const getDefaultTempShift = function(config) {
  return config.defaultTempShift || -17;
}


Server.startServer = function(server) {
  const config = Server.config;
  const probes = new Object();
  const probesHistory = new Object();

  // set defaults
  if (config.warn === undefined) {
    config.warn = 5.6;
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

  let scaleC = config.scaleC;
  if (scaleC === undefined) {
    scaleC = true;
  }

  if (config.estimateWindow === undefined) {
    config.estimateWindow = 10;
  }

  const toF = function(temp) {
    return Math.ceil((temp*1.8 + 32));
  }

  const calculateRemainingTime = function(history) {
    let remainingTime = '?';
    const historyLength = history.temps.length;
    const lastMeasurementTime = history.timestamps[historyLength - 1];
    const windowStart = lastMeasurementTime - config.estimateWindow * 60;
    const currentTemp = history.temps[historyLength -1];
    const degreesRemaining = history.targets[historyLength - 1] - currentTemp;
    if ((degreesRemaining > 0) && (historyLength > 1)) {
      let tempAtWindowStart = 0;
      let timeAtWindowStart = 0;
      for (let i = historyLength -2; i >= 0; i = i -1) {
        if (history.timestamps[i] > windowStart) {
          tempAtWindowStart = history.temps[i];
          timeAtWindowStart = history.timestamps[i];
        } else {
          break;
        }
      }
      const tempChangeOverWindow = currentTemp - tempAtWindowStart;
      const measurementTime = lastMeasurementTime - timeAtWindowStart;
      if (tempChangeOverWindow > 0) {
        // simple linear prediciton based on change over last window
        remainingTime = (degreesRemaining/
                          (tempChangeOverWindow/(measurementTime/60))).toFixed(0);
      }
    }
    return remainingTime;
  }

  // if we are in test mode add the initial test probes
  if (config.test) {
    require('./test-probes.js')(probes, probesHistory, scaleC);
  }

  const targetTemps = new Object();
  for (let i = 0; i < config.targetTemps.length; i++) {
    const meatTemps = new Object;
    for (let j = 0; j < config.targetTemps[i].temps.length; j++) {
      const key = Object.keys(config.targetTemps[i].temps[j]);
      meatTemps[key] = config.targetTemps[i].temps[j][key];
    }
    targetTemps[config.targetTemps[i].name] = meatTemps;
  }

  const eventSocket = socketio.listen(server);

  // setup mqtt
  let mqttOptions;
  if (config.mqtt.serverUrl.indexOf('mqtts') > -1) {
    mqttOptions = { key: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.key')),
                    cert: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.cert')),
                    ca: fs.readFileSync(path.join(__dirname, 'mqttclient', '/ca.cert')),
                    checkServerIdentity: function() { return undefined }
    }
  }
  const mqttClient = mqtt.connect(config.mqtt.serverUrl, mqttOptions);

  mqttClient.on('connect',function() {
    mqttClient.subscribe(config.mqtt.mqttTopic);
  });

  const SANITY_TEMP = 300;
  mqttClient.on('message', function(topic, message) {
    // decode the message
    message = message.toString();
    const TEMP_PREFIX = 'temp: '
    const deviceId = message.substring(message.indexOf('[') + 1, message.indexOf(']'));
    const temp = parseFloat(message.substring(message.indexOf(TEMP_PREFIX) + TEMP_PREFIX.length));
    const timestamp = new Date().getTime()/1000;

    if (temp <= SANITY_TEMP) {
      let deviceEntry = probes[deviceId];
      if (deviceEntry === undefined) {
        let tempShiftAmount = 0;
        if( config.shiftTemp) {
          tempShiftAmount = getDefaultTempShift(config);
        };
        deviceEntry = {type: 'temp', id: deviceId, temp: temp + tempShiftAmount, timestamp: timestamp,
                       meat: 'beef', taste: 'medium', scaleC: scaleC,
                       shiftTemp: config.shiftTemp || false, tempShiftAmount: tempShiftAmount };
        probes[deviceId] = deviceEntry;
        probesHistory[deviceId] = { timestamps: [timestamp], temps: [temp], targets: [] };
      } else {
        deviceEntry.temp = temp + deviceEntry.tempShiftAmount;
        deviceEntry.timestamp = timestamp;
        probesHistory[deviceId].timestamps.push(timestamp);
        probesHistory[deviceId].temps.push(temp + deviceEntry.tempShift);
      }
      deviceEntry.target = targetTemps[deviceEntry.meat][deviceEntry.taste];
      probesHistory[deviceId].targets.push(deviceEntry.target);
      deviceEntry.estimate = calculateRemainingTime(probesHistory[deviceId]);

      eventSocket.emit('data', deviceEntry);
    }
  });


  eventSocket.on('connection', function(ioclient) {
    eventSocket.to(ioclient.id).emit('tastes', config.targetTemps);
    eventSocket.to(ioclient.id).emit('cleanup-all');
    eventSocket.to(ioclient.id).emit('chartData', probesHistory);
    for (let deviceId in probes) {
      if (probes.hasOwnProperty(deviceId)) {
        eventSocket.to(ioclient.id).emit('data', probes[deviceId]);
      }
    }

    ioclient.on('new-meat', function(deviceId, meat) {
      probes[deviceId].meat = meat;
      let newTarget = targetTemps[meat][probes[deviceId].taste];
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
      let newTarget = targetTemps[meat][taste];
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

    ioclient.on('shift', function(deviceId, shiftTemp) {
      if (probes[deviceId].shiftTemp !== shiftTemp) {
        probes[deviceId].shiftTemp = shiftTemp;
        if (shiftTemp) {
          probes[deviceId].tempShiftAmount = getDefaultTempShift(config);
          probes[deviceId].temp = probes[deviceId].temp + probes[deviceId].tempShiftAmount;
        } else {
          probes[deviceId].temp = probes[deviceId].temp - probes[deviceId].tempShiftAmount;
          probes[deviceId].tempShiftAmount = 0;
        }
        eventSocket.emit('data', probes[deviceId]);
      }
    });
  });

  // setup timer to do cleanup and threshold checks
  setInterval(function() {
    for (let deviceId in probes) {
      if (probes.hasOwnProperty(deviceId)) {
        // when a probe is active we'll get updates regularly.  if we
        // don't get data for config.cleanupInterval then assume probe
        // was turned off and stop showing it
        const currentTime = (new Date()).getTime()/1000;
        if ((probes[deviceId].timestamp + config.cleanupInterval) < currentTime) {
          eventSocket.emit('cleanup', probes[deviceId]);
          delete probes[deviceId];
          delete probesHistory[deviceId];
        } else if (probes[deviceId].status !== 'alert') {
          if (probes[deviceId].temp >= probes[deviceId].target) {
            probes[deviceId].status = 'alert';
            eventSocket.emit('data', probes[deviceId]);

            // send out other alerts
            const alertMessage = deviceId + ': at target temp';
            notify.sendNotification(config, alertMessage);
          } else if ((probes[deviceId].status !== 'warn') &&
                     ((probes[deviceId].temp + config.warn) >= probes[deviceId].target)) {
            probes[deviceId].status = 'warn';
            eventSocket.emit('data', probes[deviceId]);

            // send out other alerts
            const warnMessage = deviceId + ': ' + convertTemp(probes[deviceId].scaleC, config.warn) + ' degrees to go';
            notify.sendNotification(config, warnMessage);
          }
        }
      }
    }
  }, 5 * 1000);
};


if (require.main === module) {
  const microAppFramework = require('micro-app-framework');
  microAppFramework(path.join(__dirname), Server);
}


module.exports = Server;
