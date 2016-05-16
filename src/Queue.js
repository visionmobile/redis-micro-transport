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
  }

  _listen() {
    // make sure blocking operation(s) client exists
    if (_.isNil(this._bClient)) {
      return; // exit
    }

    this._bClient.brpopAsync.apply(this._bClient, _.concat(Array.from(this.queues), 0))

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

    // duplicate client for blocking operation(s)
    if (_.isNil(this._bClient)) {
      this._bClient = this.client.duplicate();
    }

    // update queues registry
    this.queues.add(queue);

    // monitor queue(s) for messages
    this._listen();

    return Promise.resolve();
  }

  unsubscribe(queue) {
    // check if already subscribed to channel
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

      // close client connection if queues registry is empty
      .then(() => {
        if (this.queues.size === 0 && this._bClient) {
          this._bClient.removeAllListeners();
          this._bClient.quit();
          this._bClient = null;
        }
      });
  }

  postMessage(queue, message) {
    return this.client.lpushAsync(queue, JSON.stringify(message));
  }

}

export default Queue;
