/*
 We use semaphore to limit the number of concurrent requests to the API.
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.available = max;
    this.queue = [];
  }

  async acquire() {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    } else {
      return new Promise((resolve) => {
        this.queue.push(resolve);
      });
    }
  }

  release() {
    this.available++;
    if (this.queue.length > 0) {
      this.queue.shift()();
    }
  }
}

module.exports = Semaphore;
