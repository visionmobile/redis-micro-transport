import { EventEmitter } from 'events';
import Promise from 'bluebird';
import _ from 'lodash';

class Queue extends EventEmitter {

  constructor({ client }) {
    // setup event emitter
    super();
    this.setMaxListeners(999);

    // set custom props
    this.client = client;
    this.channels = new Set();
  }

  _listen() {
    this._bClient.brpopAsync.apply(this._bClient, _.concat(Array.from(this.channels), 0))

      .spread((queue, message) => {
        this.emit(queue, JSON.parse(message));
      })

      .finally(() => {
        if (this.channels.size !== 0) {
          this._listen(); // recurse
        }
      });
  }

  subscribe(channel) {
    // check if already subscribed to channel
    if (this.channels.has(channel) === true) {
      return Promise.resolve(); // exit gracefully
    }

    // spawn new client for blocking operation(s)
    if (!this._bClient) {
      this._bClient = this.client.duplicate();
    }

    // update channels registry
    this.channels.add(channel);

    // monitor channel(s) for messages
    this._listen();

    return Promise.resolve();
  }

  unsubscribe(channel) {
    // make sure subscribed to channel
    if (!_.isUndefined(channel) && !this.channels.has(channel)) {
      return Promise.resolve(); // exit gracefully
    }

    return Promise.resolve()

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
        if (this.channels.size === 0 && this._bClient) {
          this._bClient.quit();
          this._bClient.removeAllListeners();
          this._bClient = null;
        }
      });
  }

  postMessage(channel, message) {
    return this.client.lpushAsync(channel, JSON.stringify(message));
  }

}

export default Queue;
