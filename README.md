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

####roda(name)

####roda.transaction()

```js

roda('count').put('bob', { n: 167 });
var tx = roda.transaction();

roda('count').get('bob', tx, function(err, data){
  data.n++;
  roda('count').put('bob', data, tx);

  tx.commit(function(){
    roda('count').get('bob', function(err, val){
      console.log(val.n); //equals 168
    });
  });
});
```

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

users
  .put('bob',{ name: 'Bob' })
  .del('bob', function(){
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
####queue.use('job')
####queue.use('end')
####queue.use('error')
####queue.start()
####queue.stop()


###roda.db





##License

MIT
