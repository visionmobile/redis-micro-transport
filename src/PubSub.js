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
  }

  subscribe(channel) {
    // check if already subscribed to channel
    if (this.channels.has(channel) === true) {
      return Promise.resolve(); // exit gracefully
    }

    if (!this._bClient) {
      // duplicate client for blocking operation(s)
      this._bClient = this.client.duplicate();

      // listen for specific channel messages
      this._bClient.on('pmessage', (pattern, _channel, message) => {
        if (this.channels.has(pattern) === true) {
          this.emit(pattern, JSON.parse(message));
        }
      });
    }

    // update channels registry
    this.channels.add(channel);

    // call client subscribe
    return this._bClient.psubscribeAsync(channel);
  }

  unsubscribe(channel) {
    // make sure subscribed to channel
    if (!_.isUndefined(channel) && !this.channels.has(channel)) {
      return Promise.resolve(); // exit gracefully
    }

    // unsubscribe from redis
    return this._bClient.punsubscribeAsync(channel)

      // update channels registry
      .then(() => {
        if (_.isUndefined(channel)) {
          this.channels.clear(); // remove all channels
        } else {
          this.channels.delete(channel);
        }
      })

      // close client connection if channels registry is empty
      .then(() => {
        if (this.channels.size === 0) {
          this._bClient.quit();
          this._bClient = null; // garbage collect
        }
      });
  }

  postMessage(channel, message) {
    return this.client.publishAsync(channel, JSON.stringify(message));
  }

}

export default PubSub;
