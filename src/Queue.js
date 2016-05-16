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
    this.queues = new Set();
    this.isConnected = false;
    this.bClient = null;
  }

  _listen() {
    this.bClient.brpopAsync.apply(this.bClient, _.concat(Array.from(this.queues), 0))

      .spread((queue, message) => {
        this.emit(queue, JSON.parse(message));
      })

      .finally(() => {
        // as long as queues registry ain't empty
        if (this.queues.size !== 0) {
          this._listen(); // recurse
        }
      });
  }

  subscribe(queue) {
    // check if already subscribed to queue
    if (this.queues.has(queue) === true) {
      return Promise.resolve(); // exit
    }

    return Promise.resolve()

      // open client connection
      .then(() => {
        if (this.isConnected) {
          return false; // shouldStartListening = true
        }

        // duplicate client for blocking operation(s)
        this.bClient = this.client.duplicate();

        // update internal state
        this.isConnected = true;

        return true; // shouldStartListening = true
      })

      // update queues registry
      .tap(() => {
        this.queues.add(queue);
      })

      // initiate internal listen operation
      .then((shouldStartListening) => {
        if (shouldStartListening) {
          this._listen();
        }
      });
  }

  unsubscribe(queue) {
    // check if queues registry is empty
    if (this.queues.size === 0) {
      return Promise.resolve(); // exit gracefully
    }

    // make sure queue exists in queues registry
    if (!_.isUndefined(queue) && !this.queues.has(queue)) {
      return Promise.resolve(); // exit gracefully
    }

    return Promise.resolve()

      // update queues registry
      .tap(() => {
        if (_.isUndefined(queue)) {
          this.queues.clear(); // remove all queues
        } else {
          this.queues.delete(queue);
        }
      })

      // close client connection
      .tap(() => {
        if (this.isConnected && this.queues.size === 0) {
          // remove all listeners + quit connection
          this.bClient.removeAllListeners();
          this.bClient.quit();

          // update internal state
          this.bClient = null;
          this.isConnected = false;
        }
      });
  }

  postMessage(queue, message) {
    return this.client.lpushAsync(queue, JSON.stringify(message));
  }

}

export default Queue;
