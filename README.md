#Rodabase

Transactional, embedded document store for Node.js, built on [LevelDB](https://github.com/rvagg/node-levelup).

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)

```bash
$ npm install rodabase leveldown
```
[LevelDOWN](https://github.com/rvagg/node-leveldown) is the default backend store for LevelDB. 

###rodabase(path[, options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```

###CRUD

```js

```
####roda(name)

####.put([id], doc, [tx], [cb])

####.del(id, [cb])

####.read([options], [cb])

###Hooks
```js
roda('user').use('validate', function(ctx, next){
  if(!typeof ctx.result.name === 'string')
    return next(new Error('Name must be a string.'));

  ctx.result.name.toUpperCase();
  next();
});

roda('user').put({ name: 123 }, function(err, val){
  //Error: Name must be a string.
});
roda('user').put({ name: 'bob' }, function(err, val){
  console.log(val.name); //BOB
});
```

####.use('validate', [hook...])
####.use('diff', [hook...])
```js
var users = roda('uses');
var logs = roda('logs');

users.use('diff', function(ctx, next){
  if(!ctx.current && ctx.result)
    logs.put({
      msg: ctx.result._id + " created"
    }, ctx.transaction);

  if(ctx.current && !ctx.result)
    logs.put({
      msg: ctx.current._id + " deleted"
    }, ctx.transaction);

  next();
});

users.put('bob',{ name: 'Bob' });
users.del('bob', function(){
  logs.read(function(err, data){
    console.log(data); 
    //[{... msg: "bob created"...}, {... msg: "bob deleted"... }]
  });
});
```

###Changes

####.changes([since], [limit], [cb])
####.clock([cb])

###Queue

####.queue(queueName)

```js
roda('user')
  .queue('email')
    .use('job', function(ctx, next){
      sendEmail(ctx.result.email, function(err){
        if(err) return next(err);

        //email sent
        next();
      });
    })
    .start();

roda('user').put({
  username: 'bob',
  email: 'bob@example.com'
}, function(err, data){
  //bob added. email comes afterwards.
});

```

####queue.start()
####queue.stop()
####queue.use('job', [hook...])
####queue.use('end', [hook...])
####queue.use('error', [hook...])

###Utilities

####roda.db

[LevelUP](https://github.com/rvagg/node-levelup) instance of Rodabase.

####roda(name).store

[level-sublevel](https://github.com/dominictarr/level-sublevel) section instance under namespace `name`.


####roda.transaction()

Create a new transaction instance of [level-async-transaction](https://github.com/cshum/level-async-transaction).

```js

var count = roda('count');
var transaction = roda.transaction(); //new transaction object

count.put('bob', { n: 167 });

count.get('bob', transaction, function(err, data){
  data.n++; //increment n by 1
  count.put('bob', data, transaction);

  count.get('bob', function(err, val){
    console.log(val.n); //equals 167

    tx.commit(function(){

      count.get('bob', function(err, val){
        console.log(val.n); //equals 168
      });
    });
  });
});
```





##License

MIT
