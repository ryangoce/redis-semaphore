const Redlock = require('redlock');

class Semaphore {
    constructor(key, limit, createClient) {
      this._key = key;
      this._limit = limit;
      this._createClient = createClient;

      this._redLockTtlDuration = 2000;
      this._waitingQueue = [];

      this._initialize();
    }

    async _initialize() {
        // create command client
        this._client = this._createClient('client');

        this._client.defineCommand('sanitize', {
            numberOfKeys: 2,
            lua: `
                    local availableList = KEYS[1]
                    local processingList = KEYS[2]
                    local limit = tonumber(ARGV[1])

                    local numAvailable = redis.call('LLEN', availableList)
                    local numProcessing = redis.call('LLEN', processingList)
                    local currentTaskCount = numAvailable + numProcessing;
                    local numTasksAvailable = limit - currentTaskCount

                    if (numTasksAvailable > 0) then
                        for i = currentTaskCount, limit - 1, 1 
                        do 
                            redis.call('lpush', availableList, 'task_' .. tostring(i)) 
                        end
                    end`
        });

        this._client.defineCommand('movelpush', {
            numberOfKeys: 2,
            lua: `
                    local moved = redis.call('LREM', KEYS[1], 0, ARGV[1])
                    if moved > 0 then
                        redis.call('LPUSH', KEYS[2], ARGV[1])
                    end
                    return moved`
        });


        // create redlock for leader election job
        this._redLock = new Redlock([this._client], {
            driftFactor: 0.01,
            retryCount: 3,
            retryDelay: 100,
            retryJitter: 100
        });

        // create blocking client
        this._bclient = this._createClient('bclient');

        this._doLeaderJob();
    }

    _getRedLockKey() {
        return `rsemaphore:leader-locks:${this._key}`
    }

    _getAvailableListKey() {
        return `rsemaphore:available:${this._key}`
    }

    _getProcessingListKey() {
        return `rsemaphore:processing:${this._key}`
    }

    async _doLeaderJob() {
        const self = this;
        try {
            const redLockKey = this._getRedLockKey();
            let lock = await this._redLock.lock(redLockKey, this._redLockTtlDuration);
            // acquired a lock. do the job
            let continueJob = true;
            while (continueJob) {
                try {
                    // check the list
                    await this._client.sanitize(this._getAvailableListKey(), this._getProcessingListKey(), this._limit);

                    // TODO: check expired work

                    // sleep half of the ttlduration
                    await this._sleep(this._redLockTtlDuration / 2);
                    lock = await lock.extend(this._redLockTtlDuration);
                } catch (error) {
                    console.error('error in while loop in shared job', error);
                    // if there is an error then exit while loop and then contend again
                    continueJob = false;
                }
            }
        } catch (error) {
            if (error.name == 'LockError') {
                // ignore this just try again later to acquire lock
                // console.log('lost in lock contention. will try again in', ttlDuration);
            } else {
                console.error('error in doing shared timer job', error);
            }
        } finally {
            
            // sleep before contending again
            await this._sleep(this._redLockTtlDuration);
            this._doLeaderJob();
        }
    };

    async _waitForSignal() {
        return new Promise((resolve, reject) => {
            this._waitingQueue.push(resolve);
            // only exhaust available tasks if the waitForSignal is called from zero tasks to 1
            // else just put it in the queue. and will be served later
            if (this._waitingQueue.length == 1) {
                this._exhaustTasksInQueue();
            }
        });
    }

    async _exhaustTasksInQueue() {
        while (this._waitingQueue.length > 0) {
            const taskToken = await this._bclient.brpoplpush(this._getAvailableListKey(), this._getProcessingListKey(), 0);
            const callback = this._waitingQueue.shift();
            callback(taskToken);
        }
    }

    async _sleep(timeout, rejectOnTimeout) {
        return new Promise((resolve, reject) => {
            setTimeout(function() {
                if (rejectOnTimeout) {
                    reject(new Error('timed out'));
                } else {
                    resolve();
                }
            }, timeout);
        })
    }

    async acquire() {
        const taskToken = await this._waitForSignal();
        return taskToken;
    }

    async release(taskToken) {
        await this._client.movelpush(this._getProcessingListKey(), this._getAvailableListKey(), taskToken);
    }

    // TODO: implement dispose. 
    // NOTE: forces implementors to implement clean exit of while loops and blocking calls and also cleanup resources
    async destroy() {

    }
  }

  module.exports = Semaphore;