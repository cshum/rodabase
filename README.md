#Rodabase

Transactional, replicable document store for Node.js and browsers. Built on [LevelDB](https://github.com/rvagg/node-levelup).
* [Stream](http://highlandjs.org/) and [middleware](https://github.com/cshum/ginga) based asynchronous API.
* Transaction enables snapshot isolation and linearizable local operations.
* [Casual+ consistency](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf) preserving replication mechanisms.
* Storage backends: [LevelDB](https://github.com/level/levelup/wiki/Modules#storage-back-ends) on Node.js. IndexedDB or WebSQL on browser.

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)
[![Coverage Status](https://coveralls.io/repos/cshum/rodabase/badge.svg?branch=master)](https://coveralls.io/r/cshum/rodabase?branch=master)

```bash
$ npm install rodabase leveldown@0.10.5
```
[LevelDOWN](https://github.com/rvagg/node-leveldown) is the default backend store for LevelDB. 

**License** MIT

##API
###rodabase(path, [options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```

###roda(name)

All operations are asynchronous although they don't necessarily require a callback.


<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
 

- [CRUD](#crud)
  - [.put(id, doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.post(doc, [tx], [cb])](#postdoc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
  - [.readStream([options])](#readstreamoptions)
  - [.liveStream()](#livestream)
- [Index Mapper](#index-mapper)
  - [.index(name, mapper)](#indexname-mapper)
- [Transaction](#transaction)
  - [roda.transaction()](#rodatransaction)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
- [Replication](#replication)
  - [.clockStream()](#clockstream)
  - [.changesStream([options])](#changesstreamoptions)
  - [.replicateStream([options])](#replicatestreamoptions)
- [Conflict Resolution](#conflict-resolution)
  - [.use('conflict', [hook...])](#useconflict-hook)
- [Timeline](#timeline)
  - [.timeStream([options])](#timestreamoptions)
  - [.trigger(job, [options])](#triggerjob-options)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

###CRUD
####.put(id, doc, [tx], [cb])
Create a new document or update an existing document `doc` by specifying `id`.

Optionally bind to a [transaction](#transaction) instance `tx`.

```js
roda('users').put('bob', { foo: 'bar' }, function(err, doc){
  //handle callback
});
```
Example callback `doc`:
```json
{ 
  "_id": "bob",
  "foo": "bar", 
  "_rev": "5U42CUvHEz"
}
```
####.post(doc, [tx], [cb])
Create a new document `doc` with an auto-generated `_id`.
Auto generated _id is a unique, URL-safe, time sorted string.

Optionally bind to a [transaction](#transaction) instance `tx`.
```js
roda('users').post({ foo: 'bar' }, function(err, doc){
  //handle callback
});
```
Example callback `doc`:
```json
{ 
  "_id": "FZBJIBTCaEJk8924J0A",
  "foo": "bar", 
  "_rev": "5U42CUvHF"
}
```

####.get(id, [tx], [cb])
Retrieve a document specified by `id`. If document not exists, callback with `notFound` error.

Optionally bind to a [transaction](#transaction) instance `tx`.
```js
roda('users').get('bob', function(err, doc){
  if(err){
    if(err.notFound){
      //document not exists
      return;
    }
    //I/O or other errors
    return;
  }
  //handle document here
});
```
By binding to a [transaction](#transaction) instance, can perform batched operations in an atomic, isolated manner.
```js
var tx = roda.transaction();
var users = roda('users');
var logs = roda('logs');

//Transactional get and put
users.get('bob', tx, function(err, doc){
  if(!doc)
    return tx.rollback(new Error('not exists'));

  doc.count++;
  users.put('bob', doc, tx);
  logs.post({ other: 'stuffs' }, tx);
})
tx.commit(function(err){
  //err [Error: not exists] if 'bob' not found
});
```

####.del(id, [tx], [cb])
Delete a document specified by `id`. If document not exists, callback with `notFound` error.

Optional [transaction](#transaction) instance `tx`.

####.readStream([options])
Obtain a ReadStream of the Roda section by calling the `readStream()` method. The resulting stream is a [Highland](http://highlandjs.org/), Node Readable stream.
You can specify range options control the range of documents that are streamed. See [Index Mapper](#index-mapper) for more examples.

Optional `options` object with the following options:
  * `gt` (greater than), `gte` (greater than or equal) define the lower bound of `_id` or `_key` to be streamed. When `reverse: true` the order will be reversed, but the documents streamed will be the same.
  * `lt` (less than), `lte` (less than or equal) define the higher bound of `_id` or `_key` to be streamed. When `reverse: true` the order will be reversed, but the documents streamed will be the same.
  * `reverse` boolean, default `false`, set `true` to reverse stream output.
  * `limit` number, limit the number of results. Default no limit.
  * `index` define the [index mapper](#index-mapper) to be used. Default indexed by `_id`.
  * `prefix` define the string or array prefix of `_id` or `_key` to be streamed. Default no prefix.

####.liveStream()
Obtain a never ending ReadStream of the Roda section for reading real-time changes of documents.

###Index Mapper
####.index(name, mapper)
#####Secondary index

```js
var users = roda('users');

users.index('email', function(doc, emit){
  emit(doc.email, true); //unique
});
users.index('age', function(doc, emit){
  emit(doc.age); //can be non-unique
});

users.readStream({ index: 'age', gt: 15 }); //Stream users over age 15
users.readStream({ index: 'email', eq: 'adrian@cshum.com' }); //Stream user of email 'adrian@cshum.com'
```
#####Mapping & filtering
#####Prefixing
###Transaction

####roda.transaction()

Creates a new transaction instance of [level-async-transaction](https://github.com/cshum/level-async-transaction).
Enable transactional operations by injecting instance into `get()`, `put()`, `del()`.
Example below demonstrates isolation in transaction instance. 

```js
var count = roda('count');

//create transaction instances
var tx = roda.transaction(); 
var tx2 = roda.transaction();

count.put('foo', { n: 167 }, tx);

tx.commit(function(){
  //tx2 increments n
  count.get('foo', tx2, function(err, doc){
    doc.n++;
    count.put('foo', doc, tx2);
  });

  count.get('foo', function(err, doc){
    //doc.n equals 167
    tx2.commit(function(){
      count.get('foo', function(err, doc){
        //doc.n equals 168
      });
    });
  });
});

```

Under the hood, each write in Rodabase consists of multiple, transactional reads and writes in LevelDB,
This can be described as following steps:

1. Begin
2. `validate` hook for `put`
3. Read current state of document and clock
5. `diff` hook for `put` or `del`
6. Write document, changes and clock
7. Commit

`validate` and `diff` are transaction hook that enables fine-grain control over data integrity, validations or logging. Additional operations can be attached to current transaction, invokes only on successful commit.

####.use('validate', [hook...])

`hook` is a [Ginga middleware](https://github.com/cshum/ginga#middleware) function. 
Context object consists of the following properties:
* `ctx.result`: Resulting document, can be accessed and modified with custom validation rules.
* `ctx.transaction`: Transaction instance. Additional operations can be attached.

```js
var people = roda('people');

people.use('validate', function(ctx, next){
  if(typeof ctx.result.name !== 'string')
    return next(new Error('Name must be a string.'));
  //modify result
  ctx.result.name = ctx.result.name.toUpperCase();
  next();
});

people.put({ name: 123 }, function(err, val){
  console.log(err); //Error: Name must be a string.

  people.put({ name: 'bar' }, function(err, val){
    console.log(val.name); //BAR
  });
});
```

####.use('diff', [hook...])
At `diff` stage, access to document and section clock is acquired.
Current and resulting document can be compared for additional log, diff related operations.

`hook` is a [Ginga middleware](https://github.com/cshum/ginga#middleware) function. 
Context object consists of the following properties:
* `ctx.current`: Current state of document. `null` if this is an insert.
* `ctx.result`: Resulting document. `ctx.result._deleted === true` if this is a delete. Unlike `validation` hook, resulting document cannot be modified at this stage.
* `ctx.transaction`: Transaction instance. Additional operations can be attached.

```js
var count = roda('count');
var delta = roda('delta');

count.use('diff', function(ctx, next){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result.n || 0;

  //Transaction works across sections
  delta.put({ delta: to - from }, ctx.transaction);

  next();
});

var tx = Roda.transaction();
count.put('bob', { n: 6 }, tx);
count.put('bob', { n: 8 }, tx);
count.del('bob', tx);

tx.commit(function(){
  delta.readStream().pluck('delta').toArray(function(data){
    console.log(data); //[6, 2, -8]
  });
});
```

###Replication

####.clockStream()

Readable stream for [Lamport clocks](http://en.wikipedia.org/wiki/Lamport_timestamps) of the Roda.
Everytime a write operation is committed its logical clock is incremented.

####.changesStream([options])

####.replicateStream([options])

Changes will be queued up until `_last` matches destination timestamp.

Master-master replication.
```js
var a = roda('a');
var b = roda('b');

//a to b
b.clockStream()
  .pipe(a.changesStream({ live: true }))
  .pipe(b.replicateStream());

//b to a
a.clockStream()
  .pipe(b.changesStream({ live: true }))
  .pipe(a.replicateStream());
```

###Conflict Resolution

####.use('conflict', [hook...])

###Timeline

####.timeStream([options])

####.trigger(job, [options])
