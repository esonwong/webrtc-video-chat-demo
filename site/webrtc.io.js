(function () {

  var rtc;
  if ('undefined' === typeof module) {
    rtc = this.rtc = {};
  } else {
    rtc = module.exports = {};
  }


  // Holds a connection to the server.
  rtc._socket = null;

  // Holds identity for the client
  rtc._me = null;

  // Holds callbacks for certain events.
  rtc._events = {};

  rtc.on = function (eventName, callback) {
    rtc._events[eventName] = rtc._events[eventName] || [];
    rtc._events[eventName].push(callback);
  };

  rtc.fire = function (eventName, _) {
    var events = rtc._events[eventName];
    var args = Array.prototype.slice.call(arguments, 1);

    if (!events) {
      return;
    }

    for (var i = 0, len = events.length; i < len; i++) {
      events[i].apply(null, args);
    }
  };

  // Holds the STUN/ICE server to use for PeerConnections.
  rtc.SERVER = function () {
    return {
      "iceServers": [{
        "urls": "stun:stun.l.google.com:19302"
      }]
    };
  };


  // Reference to the lone PeerConnection instance.
  rtc.peerConnections = {};

  // Array of known peer socket ids
  rtc.connections = [];
  // Stream-related variables.
  rtc.streams = [];
  rtc.numStreams = 0;
  rtc.initializedStreams = 0;


  // Reference to the data channels
  rtc.dataChannels = {};

  // PeerConnection datachannel configuration
  rtc.dataChannelConfig = {
    "optional": [{
      "RtpDataChannels": true
    }, {
      "DtlsSrtpKeyAgreement": true
    }]
  };

  rtc.pc_constraints = {
    "optional": [{
      "DtlsSrtpKeyAgreement": true
    }]
  };


  // check whether data channel is supported.
  rtc.checkDataChannelSupport = function () {
    try {
      // raises exception if createDataChannel is not supported
      // var pc = new PeerConnection(rtc.SERVER(), rtc.dataChannelConfig);
      // var channel = pc.createDataChannel('supportCheck', {
      //   reliable: false
      // });
      // channel.close();
      return true;
    } catch (e) {
      return false;
    }
  };

  rtc.dataChannelSupport = rtc.checkDataChannelSupport();


  /**
   * Connects to the websocket server.
   */
  rtc.connect = function (server, room) {
    room = room || ""; // by default, join a room called the blank string
    rtc._socket = new WebSocket(server);

    rtc._socket.onopen = function () {
      console.log('socket open');
      rtc._socket.send(JSON.stringify({
        "eventName": "join_room",
        "data": {
          "room": room
        }
      }));

      rtc._socket.onmessage = function (msg) {
        var json = JSON.parse(msg.data);
        // console.log('socket receive message', json);
        rtc.fire(json.eventName, json.data);
      };

      rtc._socket.onerror = function (err) {
        console.error('onerror');
        console.error(err);
      };

      rtc._socket.onclose = function (data) {
        rtc.fire('disconnect stream', rtc._socket.id);
        delete rtc.peerConnections[rtc._socket.id];
      };

      rtc.on('get_peers', function (data) {
        console.log('get_peers', data);
        rtc.connections = data.connections;
        rtc._me = data.you;
        // fire connections event and pass peers
        rtc.fire('connections', rtc.connections);
      });

      rtc.on('receive_ice_candidate', function (data) {
        var candidate = new RTCIceCandidate(data.candidate);
        rtc.peerConnections[data.socketId].addIceCandidate(candidate);
        rtc.fire('receive ice candidate', candidate);
      });

      rtc.on('new_peer_connected', function (data) {
        console.log('peer ' + data.socketId + ' connected');

        rtc.connections.push(data.socketId);

        let pc = rtc.createPeerConnection(data.socketId);

        rtc.addStream(pc);
      });

      rtc.on('remove_peer_connected', function (data) {
        rtc.fire('disconnect stream', data.socketId);
        delete rtc.peerConnections[data.socketId];
      });

      rtc.on('receive_offer', function (data) {
        console.log('receive offer');
        rtc.receiveOffer(data.socketId, data.sdp);
        rtc.fire('receive offer', data);
      });

      rtc.on('receive_answer', function (data) {
        console.log('receive answer');
        rtc.receiveAnswer(data.socketId, data.sdp);
        rtc.fire('receive answer', data);
      });

      rtc.fire('connect');
    };
  };


  rtc.sendOffers = function () {
    for (var i = 0, len = rtc.connections.length; i < len; i++) {
      var socketId = rtc.connections[i];
      rtc.sendOffer(socketId);
    }
  };

  rtc.onClose = function (data) {
    rtc.on('close_stream', function () {
      rtc.fire('close_stream', data);
    });
  };

  rtc.createPeerConnections = function () {
    for (var i = 0; i < rtc.connections.length; i++) {
      rtc.createPeerConnection(rtc.connections[i]);
    }
  };

  rtc.createPeerConnection = function (id) {

    var config = rtc.pc_constraints;
    if (rtc.dataChannelSupport) config = rtc.dataChannelConfig;

    var pc = rtc.peerConnections[id] = new PeerConnection(rtc.SERVER(), config);

    pc.addEventListener('icecandidate', (event) => {
    // console.log('icecandidate event', event);
      if (event.candidate) {
        rtc._socket.send(JSON.stringify({
          "eventName": "send_ice_candidate",
          "data": {
            "label": event.candidate.sdpMLineIndex,
            "candidate": event.candidate,
            "socketId": id
          }
        }));
      }
      rtc.fire('ice candidate', event.candidate);
    });

    pc.addEventListener("connectionstatechange", (event) => {
      // console.log('connectionstatechange event', event);
      console.log('pc.connectionState', pc.connectionState);

      if (pc.connectionState === "connected") {
        rtc.fire('peer connection opened');
      }
    });

    pc.addEventListener("icecandidateerror", (event) => {
      console.log('icecandidateerror event', event);
    });

    pc.addEventListener('track', async (event) => {
      console.log('track event', event);
      rtc.fire('add remote track', event.streams, id);
    });

    // pc.addEventListener("iceconnectionstatechange", (event) => {
    //   console.log('iceconnectionstatechange event', event);
    // });

    // pc.addEventListener("error", (event) => {
    //   console.log('error event', event);
    // })
    // pc.addEventListener("negotiationneeded", (event) => {
    //   console.log('negotiationneeded event', event);
    // })



    // if (rtc.dataChannelSupport) {
    //   pc.ondatachannel = function (evt) {
    //     console.log('data channel connecting ' + id);
    //     rtc.addDataChannel(id, evt.channel);
    //   };
    // }

    pc.addEventListener('datachannel', (event) => {
      console.log('datachannel event', event);
      rtc.addDataChannel(id, event.channel);
    });

    return pc;
  };

  rtc.sendOffer = async function (socketId) {
    var pc = rtc.peerConnections[socketId];

    const offer = await pc.createOffer();
    pc.setLocalDescription(offer);

    console.log('sending offer to ' + socketId, offer);
    rtc._socket.send(JSON.stringify({
      "eventName": "send_offer",
      "data": {
        "socketId": socketId,
        "sdp": offer
      }
    }));
  };

  rtc.receiveOffer = function (socketId, sdp) {
    console.log('receive Offer', socketId, sdp);

    let pc = rtc.peerConnections[socketId];
    pc.setRemoteDescription(new RTCSessionDescription(sdp));
    rtc.sendAnswer(socketId, sdp);
  };

  rtc.sendAnswer = async function (socketId, sdp) {
    console.log('sending Answer to ' + socketId);

    let pc = rtc.peerConnections[socketId];



    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    rtc._socket.send(JSON.stringify({
      "eventName": "send_answer",
      "data": {
        "socketId": socketId,
        "sdp": answer
      }
    }));
  };


  rtc.receiveAnswer = function (socketId, sdp) {
    console.log('receive Answer', socketId, sdp);

    var pc = rtc.peerConnections[socketId];
    pc.setRemoteDescription(new RTCSessionDescription(sdp));
  };


  rtc.createStream = function (opt, onSuccess, onFail) {
    onSuccess = onSuccess || function () { };
    onFail = onFail || function () { };

    if (navigator.mediaDevices.getUserMedia) {
      rtc.numStreams++;
      navigator.mediaDevices.getUserMedia(opt).then(function (stream) {
        rtc.streams.push(stream);
        rtc.initializedStreams++;
        onSuccess(stream);
        if (rtc.initializedStreams === rtc.numStreams) {
          rtc.fire('ready');
        }
      })
        .catch(function (error) {
          rtc.fire('ready');
          console.log(error.name + ": " + error.message);
          onFail();
        })

    } else {
      alert('webRTC is not yet supported in this browser.');
    }
  };

  rtc.addStream = function (pc) {
    for (var i = 0; i < rtc.streams.length; i++) {
      var stream = rtc.streams[i];
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    }
  }

  rtc.addStreams = function () {
    for (var connection in rtc.peerConnections) {
      rtc.addStream(rtc.peerConnections[connection]);
    }
  };

  rtc.attachStream = function (stream, domId) {
    var element = document.getElementById(domId);
    if (navigator.mozGetUserMedia) {
      console.log("Attaching media stream");
      element.mozSrcObject = stream;
      element.play();
    } else {
      // element.src = webkitURL.createObjectURL(stream);
      element.srcObject = stream;
    }
  };


  rtc.createDataChannel = function (pcOrId, label) {
    if (!rtc.dataChannelSupport) {
      //TODO this should be an exception
      alert('webRTC data channel is not yet supported in this browser,' +
        ' or you must turn on experimental flags');
      return;
    }

    var id, pc;
    if (typeof (pcOrId) === 'string') {
      id = pcOrId;
      pc = rtc.peerConnections[pcOrId];
    } else {
      pc = pcOrId;
      id = undefined;
      for (var key in rtc.peerConnections) {
        if (rtc.peerConnections[key] === pc) id = key;
      }
    }

    if (!id) throw new Error('attempt to createDataChannel with unknown id');

    if (!pc || !(pc instanceof PeerConnection)) throw new Error('attempt to createDataChannel without peerConnection');

    // need a label
    label = label || 'fileTransfer' || String(id);

    // chrome only supports reliable false atm.
    var options = {
      reliable: false
    };

    var channel;
    try {
      console.log('createDataChannel ' + id);
      channel = pc.createDataChannel(label, options);
    } catch (error) {
      console.log('seems that DataChannel is NOT actually supported!');
      throw error;
    }

    return rtc.addDataChannel(id, channel);
  };

  rtc.addDataChannel = function (id, channel) {

    channel.onopen = function () {
      console.log('data stream open ' + id);
      rtc.fire('data stream open', channel);
    };

    channel.onclose = function (event) {
      delete rtc.dataChannels[id];
      console.log('data stream close ' + id);
      rtc.fire('data stream close', channel);
    };

    channel.onmessage = function (message) {
      console.log('data stream message ' + id);
      console.log(message);
      rtc.fire('data stream data', channel, message.data);
    };

    channel.onerror = function (err) {
      console.log('data stream error ' + id + ': ' + err);
      rtc.fire('data stream error', channel, err);
    };

    // track dataChannel
    rtc.dataChannels[id] = channel;
    return channel;
  };

  rtc.addDataChannels = function () {
    if (!rtc.dataChannelSupport) return;

    for (var connection in rtc.peerConnections)
      rtc.createDataChannel(connection);
  };


  rtc.on('ready', function () {
    rtc.createPeerConnections();
    rtc.addStreams();
    rtc.addDataChannels();
    rtc.sendOffers();
  });

}).call(this);