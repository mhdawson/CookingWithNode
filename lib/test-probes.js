// Copyright 2014-2016 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
"use strict";

// This function is used to add test probes to make it easier
// to iteratively develop without having to wait for data
// from physical probes
var addTestProbes = function(probes, probesHistory, scaleC) {
  probes['test'] = { type: 'temp',
                     id: 'test',
                     temp:  25.5,
                     timestamp: (new Date().getTime()/1000),
                     meat: 'beef',
                     taste: 'medium',
                     target:  71,
                     scaleC: scaleC };

  probesHistory['test'] = { timestamps: [(new Date().getTime()/1000) - 20,
                                         (new Date().getTime()/1000) - 10],
                            temps: [ 25.5, 26],
                            targets: [71,71 ] };

  probes['test2'] = { type: 'temp',
                      id: 'test2',
                      temp: 25.51,
                      timestamp: new Date().getTime()/1000,
                      meat: 'beef',
                      taste: 'medium',
                      target: 71,
                      scaleC: scaleC };
}

module.exports = addTestProbes;
