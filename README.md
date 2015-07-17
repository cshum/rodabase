# Rodabase

Transactional, replicable document store for Node.js and browsers. Built on [LevelDB](https://github.com/Level/levelup).
* [Stream](http://highlandjs.org/) and [middleware](https://github.com/cshum/ginga) based asynchronous API.
* [Transaction](#transaction) guarantees linearizable local operations.
* [Causal+ consistent](#replication) multi master replication.
* Storage backends: [LevelDB](https://github.com/Level/levelup) on Node.js; IndexedDB on browser.

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)
[![Coverage Status](https://coveralls.io/repos/cshum/rodabase/badge.svg?branch=master)](https://coveralls.io/r/cshum/rodabase?branch=master)

```bash
$ npm install rodabase
```
### License

MIT

## API

**API stable; Documentation in progress.**


<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
 

- [rodabase(path, [options])](#rodabasepath-options)
- [roda(name)](#rodaname)
  - [.put(id, doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.post(doc, [tx], [cb])](#postdoc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
- [Index](#index)
  - [.registerIndex(name, mapper)](#registerindexname-mapper)
  - [.readStream([options])](#readstreamoptions)
  - [.rebuildIndex([tag], [cb])](#rebuildindextag-cb)
- [Transaction](#transaction)
  - [roda.transaction()](#rodatransaction)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
- [Replication](#replication)
  - [.clockStream()](#clockstream)
  - [.changesStream([options])](#changesstreamoptions)
  - [.replicateStream([options])](#replicatestreamoptions)
  - [.use('conflict', [hook...])](#useconflict-hook)
- [Reactive](#reactive)
  - [.liveStream()](#livestream)
  - [.trigger(name, job, [options])](#triggername-job-options)
  - [.historyStream([options])](#historystreamoptions)

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

#### .del(id, [tx], [cb])
Delete a document specified by `id`. If document not exists, callback with `notFound` error.

Optional [transaction](#transaction) instance `tx`.

### Index
#### .registerIndex(name, mapper)
Indexes are generated or cleaned up transactionally on every write operations.

#### .readStream([options])
Obtain a ReadStream of the Roda section by calling the `readStream()` method. 
You can specify range options control the range of documents that are streamed. 

Optional `options` object with the following options:
  * `gt` (greater than), `gte` (greater than or equal) define the lower bound of `_id` or `_key` to be streamed. When `reverse: true` the order will be reversed, but the documents streamed will be the same.
  * `lt` (less than), `lte` (less than or equal) define the higher bound of `_id` or `_key` to be streamed. When `reverse: true` the order will be reversed, but the documents streamed will be the same.
  * `reverse` boolean, default `false`, set `true` to reverse stream output.
  * `limit` number, limit the number of results. Default no limit.
  * `index` define the [index mapper](#index-mapper) to be used. Default indexed by `_id`.
  * `prefix` define the string or array prefix of `_id` or `_key` to be streamed. Default no prefix.

See [Index Mapper](#index-mapper) for more options use cases.

```js
var JSONStream = require('JSONStream');

roda('files').readStream({ prefix: '/foo/' })
  .pipe(JSONStream.stringify()) //Transform stream
  .pipe(process.stdout);

//example output
[{
  "_id": "/foo/bar",
  "_rev": "5U42CUvHEz",
  ...
},{
  "_id": "/foo/boo",
  "_rev": "5U42CUvHF",
  ...
},...]
```

##### Secondary index

```js
var users = roda('users');

users.registerIndex('email', function(doc, emit){
  emit(doc.email, true); //unique
});
users.registerIndex('age', function(doc, emit){
  emit(doc.age); //can be non-unique
});

users.readStream({ index: 'age', gt: 15 }); //Stream users age over 15
users.readStream({ index: 'email', eq: 'adrian@cshum.com' }); //Stream user of email 'adrian@cshum.com'
```
##### Mapping & filtering
##### Prefixing

#### .rebuildIndex([tag], [cb])

Indexes need to be rebuilt when `registerIndex()` *after* a document is committed, or when `mapper` function has changed.

`rebuildIndex()` will rebuild *all* registered index within the roda section. Optionally specify `tag` so that indexes will only get rebuilt when `tag` has changed.

```js
users.rebuildIndex('1.1', function(){
  //indexes 1.1 rebuilt successfully.
});

```

### Transaction
Transaction guarantees linearizable consistency for local operations, which avoids many unexpected behavior and simplifies application development.

LevelDB supports atomic batched operations. This is an important primitive for building solid database functionality with inherent consistency.
Rodabase leverages [level-transactions](https://github.com/cshum/level-transactions) for two-phase locking and snapshot isolation.

#### roda.transaction()

Creates a new transaction instance. `get()`, `put()`, `del()` methods can be binded to the transaction instance, to perform operations in a sequential, atomic, isolated manner.
```js
var users = roda('users');
var logs = roda('logs');

//Transactional get and put
var tx = roda.transaction();
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

Rodabase supports [middleware hooks](https://github.com/cshum/ginga#middleware), 
with `validate` and `diff` invoked on every write operations transactionally. 

#### .use('validate', [hook...])
`validation` invoked at the beginning of a write operation. Result can be validated and changes can be made before the document is locked.

Context object consists of the following properties:
* `result`: Result document before locking. Changes can be made during this stage.
* `transaction`: Transaction instance. Additional operations can be binded.

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
people.post({ name: 'bar' }, function(err, val){
  //val.name === 'BAR'
});
```

#### .use('diff', [hook...])
`diff` invoked when document is locked.
Current and resulting state of the document can be accessed 
for additional log, diff related operations.

Context object consists of the following properties:
* `current`: Current state of document. `undefined` if this is a fresh insert.
* `result`: Resulting document. `ctx.result._deleted === true` if this is a delete. Unlike `validation` middleware, resulting document cannot be modified at this stage.
* `transaction`: Transaction instance. Additional operations can be binded.

```js
var count = roda('count');
var delta = roda('delta');

count.use('diff', function(ctx){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result.n || 0;

  //Transaction works across sections
  delta.post({ delta: to - from }, ctx.transaction);
});

var tx = Roda.transaction();
count.put('bob', { n: 6 }, tx);
count.put('bob', { n: 8 }, tx);
count.del('bob', tx);

tx.commit(function(){
  delta.readStream().pluck('delta').toArray(function(data){
    //data
    [6, 2, -8]
  });
});
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

#### .clockStream()

Readable stream of latest revisions i.e. lamport clocks of database section.

#### .changesStream([options])

#### .replicateStream([options])

```js
//a replicate to b
b.clockStream()
  .pipe(a.changesStream({ live: true }))
  .pipe(b.replicateStream());
```

#### .use('conflict', [hook...])

### Reactive

Subscribe to past and live updates of Rodabase.

#### .liveStream()
Obtain a never ending ReadStream for reading real-time updates of documents.

Rodabase streams are Node Readable stream based on [Highland.js](http://highlandjs.org/).

```js
roda('users').liveStream()
  .filter(function(doc){
    return doc.age > 15;
  })
  .each(function(doc){
    //receive live updates of user age over 15
  })
```

#### .trigger(name, job, [options])

Job must be idempotent. If the process crashes before job has calledback, it will be rerun the next time it's started

```js
//Email will be sent after `users` updated.
roda('users').trigger('email_update', function(doc, done){
  //asynchronous email function. 
  if(!doc._deleted)
    sendMail({
      from: 'Foo Bar <noreply@foo.bar>', 
      to: doc.email,
      subject: 'Hello ' + doc.username,
      html: 'Your profile is updated.'
    }, done);
  else
    done(null); //skip if deleted
});
```

#### .historyStream([options])

