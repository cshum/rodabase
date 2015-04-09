#Rodabase

Transactional, embedded document store for Node.js, built on [LevelDB](https://github.com/rvagg/node-levelup).

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)

```bash
$ npm install rodabase leveldown
```
[LevelDOWN](https://github.com/rvagg/node-leveldown) is the default backend store for LevelDB. 

**License** MIT

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**API**

- [rodabase(path[, options])](#rodabasepath-options)
- [roda(name)](#rodaname)
  - [.put([id], doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
  - [.read([options], [cb])](#readoptions-cb)
- [Transaction](#transaction)
  - [roda.transaction()](#rodatransaction)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
- [Changes](#changes)
  - [.changes([since], [limit], [cb])](#changessince-limit-cb)
  - [.clock([cb])](#clockcb)
- [Queue](#queue)
  - [.queue(name)](#queuename)
- [Utilities](#utilities)
  - [roda.db](#rodadb)
  - [roda(name).store](#rodanamestore)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

###rodabase(path[, options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```

###roda(name)

####.put([id], doc, [tx], [cb])

```js
//specify _id
roda('stuff').put('bob', { foo: 'bar' });
roda('stuff').put({ _id: 'bob', foo: 'bar' });

//auto generated _id
roda('stuff').put({ foo: 'bar' }, function(err, res){
  if(err) 
    return console.error('Error: ', err);

  console.log(res);
  /* Example response
  { 
    "_id": "FZBJIBTCaLEJk8924J0A",
    "foo": "bar", 
    "_rev": "k8924J0AFZ"
  } 
  */
}); 

```

####.get(id, [tx], [cb])

####.del(id, [tx], [cb])

####.read([options], [cb])

###Transaction

####roda.transaction()

Create a new transaction instance.

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

####.use('validate', [hook...])
```js
var people = roda('people');

people.use('validate', function(ctx, next){
  if(typeof ctx.result.name !== 'string')
    return next(new Error('Name must be a string.'));

  //modify result
  ctx.result.name = ctx.result.name.toUpperCase();

  //check existing
  people.get(ctx.result._id, ctx.transaction, function(err, val){
    if(val)
      return next(new Error(ctx.result._id + ' already existed.'));
    next();
  });
});

people.put('foo', { name: 123 }, function(err, val){
  console.log(err); //Error: Name must be a string.
});
people.put('foo', { name: 'bar' }, function(err, val){
  console.log(val.name); //BAR
});
people.put('foo', { name: 'bob' }, function(err, val){
  console.log(err); //Error: foo already existed.
});
```

####.use('diff', [hook...])
```js
var count = roda('count');
var log = roda('log');

count.use('diff', function(ctx, next){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result ? ctx.result.n : 0;

  log.put({ delta: to - from }, ctx.transaction);

  next();
});

count.put('bob',{ n: 6 });
count.put('bob',{ n: 8 });
count.del('bob', function(){
  log.read(function(err, data){
    console.log(data); 
    //[{ delta: 6 ...}, { delta: 2 ...}, { delta: -8 ...}]
  });
});
```

###Changes

####.changes([since], [limit], [cb])
####.clock([cb])

###Queue

####.queue(name)

```js
var users = roda('users');

users.queue('email')
  .use('job', function(ctx, next){
    sendEmail(ctx.result.email, function(err){
      if(err) return next(err);

      //email sent
      next();
    });
  })
  .start();

users.put({
  username: 'bob',
  email: 'bob@example.com'
}, function(err, data){
  //bob added. Email comes afterwards.
});

```
#####.use('job', [hook...])
#####.use('end', [hook...])
#####.use('error', [hook...])
#####.start()
#####.stop()

###Utilities

####roda.db

[LevelUP](https://github.com/rvagg/node-levelup) instance of Rodabase.

####roda(name).store

[level-sublevel](https://github.com/dominictarr/level-sublevel) section instance under namespace `name`.


