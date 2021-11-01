# Introduction

This is a very simple implementation of distributed semaphore using redis.  This should be better than the other implementation which uses polling.  What this library uses is redis BRPOPLPUSH to instantly get messages instead of the usual polling approach

# Usage

```javascript
const Semaphore = require('../index').Semaphore;
const Redis = require('ioredis');

const redisClient = new Redis(6379, 'localhost');

const concurrency = 1;
const numberOfTasksToDo = 3;
const taskTimeToFinish = 1000;
const semaphore = new Semaphore('lock_this_resource', 
    concurrency,  
    function (type) {
        switch (type) {
            case 'client':
                return redisClient;

            case 'bclient':
                return new Redis(6379, 'localhost');

            default:
                throw new Error('not known type');
        }
    }
);

// acquire a lock and a get a token
const token = await semaphore.acquire();

// sleep for some time
await sleep(taskTimeToFinish);

// release the lock
await semaphore.release(token);




```