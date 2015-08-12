# Rodabase

Transactional, replicable document store for Node.js and browsers. Built on [LevelDB](https://github.com/Level/levelup).
* [Streams](http://highlandjs.org/) and [middleware](https://github.com/cshum/ginga) based asynchronous API.
* [Transactions](#transaction) guarantee linearizable local operations.
* [Causal+ consistent](#replication), transport-agnostic multi master replication.
* Storage backends: [LevelDB](https://github.com/Level/levelup) on Node.js; IndexedDB on browser.

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)
[![Coverage Status](https://coveralls.io/repos/cshum/rodabase/badge.svg?branch=master)](https://coveralls.io/r/cshum/rodabase?branch=master)

```bash
$ npm install rodabase
```

### License

MIT

## API

**API stable; documentation in progress.**

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
 

- [rodabase(path, [options])](#rodabasepath-options)
- [roda(name)](#rodaname)
  - [.put(id, doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.post(doc, [tx], [cb])](#postdoc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
- [Transaction](#transaction)
  - [roda.transaction()](#rodatransaction)
- [Hooks](#hooks)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
  - [.use('conflict', [hook...])](#useconflict-hook)
- [Index](#index)
  - [.registerIndex(name, mapper)](#registerindexname-mapper)
  - [.rebuildIndex([tag], [cb])](#rebuildindextag-cb)
  - [.readStream([options])](#readstreamoptions)
  - [.getBy(index, key, [tx], [cb])](#getbyindex-key-tx-cb)
- [Replication](#replication)
  - [.liveStream()](#livestream)
  - [.clockStream()](#clockstream)
  - [.changesStream([options])](#changesstreamoptions)
  - [.replicateStream([options])](#replicatestreamoptions)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

### rodabase(path, [options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```
### roda(name)
#### .put(id, doc, [tx], [cb])
Create a new document or update an existing document `doc` by specifying `id`.

Optionally bind to a [transaction](#transaction) instance `tx`.

```js
roda('users').put('bob', { foo: 'bar' }, function(err, doc){
  //example doc
  { 
    "_id": "bob",
    "foo": "bar", 
    "_rev": "5U42CUvHEz"
  }
});
```
#### .post(doc, [tx], [cb])
Create a new document `doc` with an auto-generated `_id`.
Auto generated _id is a unique, URL-safe, time sorted string.
Optionally bind to a [transaction](#transaction) instance `tx`.
```js
roda('users').post({ foo: 'bar' }, function(err, doc){
  //example doc
  { 
    "_id": "FZBJIBTCaEJk8924J0A",
    "foo": "bar", 
    "_rev": "5U42CUvHF"
  }
});
```

#### .get(id, [tx], [cb])
Retrieve a document specified by `id`. If `id` not exists, callback with `notFound` error.
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

#### .del(id, [tx], [cb])
Delete a document specified by `id`. If document not exists, callback with `notFound` error.
Optionally bind to a [transaction](#transaction) instance `tx`.

### Transaction
Transactions in Rodabase guarantee linearizable consistency for local operations, which 
avoids unexpected behavior and simplifies application development.

LevelDB supports atomic batched operations,
while durability is configurable via `sync` [option](https://github.com/Level/levelup#options-1) of LevelDB.
Rodabase leverages [level-transactions](https://github.com/cshum/level-transactions) for two-phase locking and snapshot isolation, which makes it ACID compliant.

#### roda.transaction()

Creates a new transaction instance. `get()`, `put()`, `del()`, `getBy()` methods can be binded to the transaction instance, to perform operations in a sequential, atomic, isolated manner.
```js
//Transactional get and put
var tx = roda.transaction();
roda('users').get('bob', tx, function(err, doc){
  if(!doc)
    return tx.rollback(new Error('not exists'));

  doc.count++;

  //only presists if commit success
  roda('users').put('bob', doc, tx);
  roda('foo').put('bar', { hello: 'world' }, tx);
})
tx.commit(function(err){
  //err [Error: not exists] if 'bob' not found
});
```

### Hooks

#### .use('validate', [hook...])
`validation` triggered when putting a document. Invoked at the beginning of a write operation, result can be validated and changes can be made before the document is locked.

Context object consists of the following properties:
* `result`: Result document before locking.

```js
var people = roda('people');

people.use('validate', function(ctx, next){
  if(typeof ctx.result.name !== 'string')
    return next(new Error('Name must be a string.'));

  //modify result
  ctx.result.name = ctx.result.name.toUpperCase();

  next();
});

people.post({ name: 123 }, function(err, val){
  //Error: Name must be a string.
});
people.put('foo', { name: 'bar' }, function(err, val){
  //val.name === 'BAR'
});
people.del('foo'); //will not trigger validate
```

#### .use('diff', [hook...])
`diff` triggered when putting and deleting a document.
Invoked when document is locked, current and resulting states of document are accessible.
It also exposes the transaction instance, which makes it a very powerful mechanism for  a lot of use cases, such as 
enforcing data integrity and permissions, creating arbitrary triggers and versioning patterns. 

Context object consists of the following properties:
* `current`: Current state of document. `null` if this is an insert.
* `result`: Resulting document. `null` if this is a delete.
* `transaction`: Transaction instance.

```js
var data = roda('data');
var logs = roda('logs');

data.use('diff', function(ctx, next){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result ? ctx.result.n : 0;

  //Transaction works across sections
  logs.post({ delta: to - from }, ctx.transaction);

  next();
});

var tx = roda.transaction();

data.put('bob', { n: 6 }, tx);
data.put('bob', { n: 8 }, tx);
data.put('bob', { n: 9 }, tx);
data.del('bob', tx);

tx.commit(function(){
  logs.readStream().pluck('delta').toArray(...); //[6, 2, 1, -9]
});
```

#### .use('conflict', [hook...])


### Index

Rodabase supports secondary indexes using mapper function. Indexes are calculated transactionally, results can be retrieved right after callback of a successful write.

#### .registerIndex(name, mapper)

Register an index named `name` using `mapper` function. 

`mapper` is provided with document object and emit function `function(doc, emit){}`.

`emit` conists of arguments `emit(key, [doc], [unique])` that must be called synchronously within the `mapper`:
* `key` index key. Unlike `_id`, `key` can be arbitrary object for sorting, such as String, Number, Date or prefixing with Array. Except `null` or `undefined` key is not allowed.
* `doc` object, optionally specify the mapped document object.
* `unique` boolean. If `true`, `key` must be unique within the index, otherwise writes callback with `exists` error. Default `false`.

```js
//Non unique index
roda('users').registerIndex('age', function(doc, emit){
  emit(doc.age); //can be non-unique
});

//Unique index
roda('users').registerIndex('email', function(doc, emit){
  emit(doc.email, true); //unique
});

//Multiple emits, Array prefixed
roda('posts').registerIndex('tag', function(doc, emit){
  if( Array.isArray(doc.tags) )
    doc.tags.forEach(function(tag){
      emit([tag, doc.updated]);
    });
});

//Conditional emit, sorted by updated
roda('posts').registerIndex('recent', function(doc, emit){
  if(doc.active) emit(doc.updated);
});

```

#### .rebuildIndex([tag], [cb])

Indexes need to be rebuilt when `registerIndex()` *after* a document is committed, or when `mapper` function has changed.

`rebuildIndex()` will rebuild *all* registered index within the roda section. Optionally specify `tag` so that indexes will only get rebuilt when `tag` has changed.

```js
users.rebuildIndex('1.1', function(){
  //indexes 1.1 rebuilt successfully.
});

```


#### .readStream([options])
Obtain a ReadStream of the Roda section by calling the `readStream()` method. 
You can specify range options control the range of documents that are streamed. `options` accepts following properties:
  * `gt` (greater than), `gte` (greater than or equal) define the lower bound of `_id` or `_key` to be streamed. When `reverse: true` the order will be reversed, but the documents streamed will be the same.
  * `lt` (less than), `lte` (less than or equal) define the higher bound of `_id` or `_key` to be streamed. When `reverse: true` the order will be reversed, but the documents streamed will be the same.
  * `reverse` boolean, default `false`, set `true` to reverse stream output.
  * `limit` number, limit the number of results. Default no limit.
  * `index` define [index](#index) to be used. Default indexed by `_id`.
  * `prefix` define string or array prefix of `_id` or `_key` to be streamed. Default no prefix.

```js
var JSONStream = require('JSONStream'); //JSON transform stream

//Streams consumption
roda('stuffs').readStream()
  .pipe(JSONStream.stringify())
  .pipe(process.stdout); //pipe to console

app.get('/api/stuffs', function(req, res){
  roda('stuffs').readStream()
    .pipe(JSONStream.stringify())
    .pipe(res); //pipe to express response
});

roda('files').readStream({
  prefix: '/foo/' //String prefix
}).toArray(function(list){
  //possible output
  [{
    "_id": "/foo/bar",
    "_rev": "5U42CUvHEz",
    ...
  },{
    "_id": "/foo/boo",
    "_rev": "5U42CUvHF",
    ...
  },...]
});

roda('users').readStream({
  index: 'age', 
  gte: 15 //users of age at least 15
}).pipe(...); 

roda('posts').readStream({
  index: 'tag', 
  prefix: ['foo'], //Array prefix
  gt: Date.now() - 1000 * 60 * 60, //since last hour
  reverse: true
}).toArray(function(list){
  //possible output
  [{
    _key: ['foo', 1437203371250],
    tags: ['foo', 'bar', 'hello']
    ...
  }, {
    _key: ['foo', 1437203321128],
    tags: ['world', 'foo']
    ...
  },...]
});

```
#### .getBy(index, key, [tx], [cb])
Retrieve a uniquely indexed document specified by `index` and `key`. 
Only available for indexes with `unique` flag.
If `key` not exists, callback with `notFound` error.
Optionally bind to a [transaction](#transaction) instance `tx`.
```js
//email index
roda('users').registerIndex('email', function(doc, emit){
  emit(doc.email, true); //unique email index
});

//Transactional
var tx = roda.transaction();

roda('users')
  .put('foo', { email: 'foo@bar.com', age: 167 }, tx)
  .getBy('email', 'foo@bar.com', tx, function(err, doc){
     //example doc
     {
       _id: 'foo',
       _key: 'foo@bar.com',
       _rev: '5U42CUvHEz',
       email: 'foo@bar.com',
       age: 167
     }
  })
  .del('foo', tx)
  .getBy('email', 'foo@bar.com', tx, function(err, doc){
     //notFound error
  });

tx.commit(...);

```

### Replication

Rodabase supports multi-master replication that preserves **Causal+** - causal consistency with convergent conflict handling.
The implementation loosely follows the **COPS-CD** approach as presented in the article: [Don’t Settle for Eventual: Scalable Causal Consistency for Wide-Area Storage with COPS](http://sns.cs.princeton.edu/docs/cops-sosp11.pdf). 

* Maintaining partial ordering that respects potential causality, using Lamport clocks.
* Keeping track of nearest gets-from dependency for each write.
* Replication queue that commits write only when causal dependencies have been satisfied.

Special fields are reserved of identifying states of documents:

* `_rev` (revision) current revision of document that resembles a lamport clock. Consists of two parts: 
  * `mid` - ID of `roda()` section.
  * `seq` - lamport timestamp that increments based on casual dependencies.
* `_from` (gets from) nearest gets-from dependency. Generated on write operation from a replicated document.
* `_after` (write after) `seq` of previous local write for keeping track of execution order.

Rodabase exposes replication mechanism as Node.js stream, which is transport-agnostic:
* [roda-socket.io](https://github.com/cshum/roda-socket.io) - Socket.IO transport.

#### .liveStream()

#### .clockStream()

Readable stream of latest revisions i.e. lamport clocks of database section.

#### .changesStream([options])

#### .replicateStream([options])

```js
//a replicate to b
var ar = a.replicateStream();
var br = b.replicateStream();

a.pipe(b).pipe(a)
```
