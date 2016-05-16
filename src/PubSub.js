import { EventEmitter } from 'events';
import Promise from 'bluebird';
import _ from 'lodash';

class PubSub extends EventEmitter {

  constructor({ client }) {
    // setup event emitter
    super();
    this.setMaxListeners(999);

    // set custom props
    this.client = client;
    this.channels = new Set();
    this.isConnected = false;
    this.bClient = null;
  }

  subscribe(channel) {
    // check if already subscribed to channel
    if (this.channels.has(channel) === true) {
      return Promise.resolve(); // exit gracefully
    }

    return Promise.resolve()

      // open client connection
      .tap(() => {
        if (!this.isConnected) {
          // duplicate client for blocking operation(s)
          this.bClient = this.client.duplicate();

          // listen for specific channel messages
          this.bClient.on('pmessage', (pattern, _channel, message) => {
            if (this.channels.has(pattern) === true) {
              this.emit(pattern, JSON.parse(message));
            }
          });

          // update internal state
          this.isConnected = true;
        }
      })

      // update channels registry
      .tap(() => {
        this.channels.add(channel);
      })

      // subscribe to channel
      .then(() => {
        return this.bClient.psubscribeAsync(channel);
      });
  }

  unsubscribe(channel) {
    // check if channels registry is empty
    if (this.channels.size === 0) {
      return Promise.resolve(); // exit gracefully
    }

    // make sure channel exists in channels registry
    if (!_.isUndefined(channel) && !this.channels.has(channel)) {
      return Promise.resolve(); // exit gracefully
    }

    // unsubscribe from channel
    return this.bClient.punsubscribeAsync(channel || '')

      // update channels registry
      .tap(() => {
        if (_.isUndefined(channel)) {
          this.channels.clear(); // remove all channels
        } else {
          this.channels.delete(channel);
        }
      })

      // close client connection
      .tap(() => {
        if (this.isConnected && this.channels.size === 0) {
          // remove all listeners + quit connection
          this.bClient.removeAllListeners();
          this.bClient.quit();

          // update internal state
          this.bClient = null;
          this.isConnected = false;
        }
      });
  }

  postMessage(channel, message) {
    return this.client.publishAsync(channel, JSON.stringify(message));
  }

}

export default PubSub;
