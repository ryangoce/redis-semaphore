(async function() {

    // Features
    /*
        1. Efficient waiting using blocking variants of redis commands
        2. Atomic Reliable queue (brpoplpush)
        3. get set initialize with multiple tokens
        4. somehow it is fair within same instance of the Semaphore

        NEXT:
        1. benchmark
        2. fair semaphore
        3. what if release is not called?
        4. implement destroy
        5. optimal redis usage if Semaphore object is instantiated more than once
    */
    const sleep = function(timeout) {
        return new Promise((resolve) => {
            setTimeout(resolve, timeout);
        });
    } 

    const Semaphore = require('./index').Semaphore;
    const Redis = require('ioredis');
    
    const redisClient = new Redis(6379, 'localhost');
    
    const semaphore = new Semaphore('abc', 2, function(type) {
        switch (type) {
            case 'client':
                return redisClient;
    
            case 'bclient':
                return new Redis(6379, 'localhost');
        
            default:
                throw new Error('not known type');
        }
    });
    
    const taskToken1 = await semaphore.acquire();
    console.log('acquired 1');
    const taskToken2 = await semaphore.acquire();
    console.log('acquired 2');

    setTimeout(() => {
        semaphore.release(taskToken1);
        semaphore.release(taskToken2);
        console.log('settimeout triggered. task1 and task2 released');
    }, 10000);

    const taskToken3 = await semaphore.acquire();
    console.log('acquired 3');
    await sleep(1000);

    await semaphore.release(taskToken3);

    console.log('all released');
})();