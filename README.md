#Rodabase

Transactional, replicable document store for building microservices on Node.js and browsers. Based on [LevelDB](https://github.com/rvagg/node-levelup).
* Stream and middleware based asynchronous API.
* [Transaction](#transaction) guarantees linearizable local operations.
* [Causal+ consistent](#replication) multi master replication.
* Storage backends: LevelDB on Node.js; IndexedDB on browser.

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)
[![Coverage Status](https://coveralls.io/repos/cshum/rodabase/badge.svg?branch=master)](https://coveralls.io/r/cshum/rodabase?branch=master)

```bash
$ npm install rodabase
```
## License

MIT

## API


<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
 

- [rodabase(path, [options])](#rodabasepath-options)
- [roda(name)](#rodaname)
  - [.put(id, doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.post(doc, [tx], [cb])](#postdoc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
  - [.readStream([options])](#readstreamoptions)
  - [.liveStream()](#livestream)
- [Transaction](#transaction)
  - [roda.transaction()](#rodatransaction)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
- [Index Mapper](#index-mapper)
  - [.index(name, mapper)](#indexname-mapper)
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
  /* example doc
  { 
    "_id": "bob",
    "foo": "bar", 
    "_rev": "5U42CUvHEz"
  }
  */
});
```
#### .post(doc, [tx], [cb])
Create a new document `doc` with an auto-generated `_id`.
Auto generated _id is a unique, URL-safe, time sorted string.

Optionally bind to a [transaction](#transaction) instance `tx`.
```js
roda('users').post({ foo: 'bar' }, function(err, doc){
  /* example doc
  { 
    "_id": "FZBJIBTCaEJk8924J0A",
    "foo": "bar", 
    "_rev": "5U42CUvHF"
  }
  */
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

Rodabase streams are Node Readable stream based on [Highland.js](http://highlandjs.org/).
It is possible to manipulate data using both Highland's method and Node-compatible streams.
```js
var JSONStream = require('JSONStream');

roda('files').readStream({ prefix: '/foo/', limit: 3 })
  .pluck('_id') //highland method
  .pipe(JSONStream.stringify()) //Node transform stream
  .pipe(process.stdout);

/* possible output
["/foo/", "/foo/abc", "/foo/bar"]
*/
```

#### .liveStream()
Obtain a never ending ReadStream for reading real-time updates of documents.
```js
//receive updates of user age over 15
roda('users').liveStream()
  .filter(function(doc){
    return doc.age > 15;
  })
  .each(console.log.bind(console))
```

### Transaction
Transaction guarantees linearizable consistency for local operations, which avoids many unexpected behavior and simplifies application development.

To make this works, LevelDB and IndexedDB both support atomic batched operations. This is an important primitive for building solid database functionality with inherent consistency.
Rodabase takes a step further to support two-phase locking and snapshot isolation:

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

Rodabase uses [middleware](https://github.com/cshum/ginga#middleware), 
with `validate` and `diff` hooks invoked on every write operations of both local and replicated documents. 
These keep track of document changes and integrity check, in a transactional manner.

####.use('validate', [hook...])
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

####.use('diff', [hook...])
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

### Index Mapper
#### .index(name, mapper)
##### Secondary index

```js
var users = roda('users');

users.index('email', function(doc, emit){
  emit(doc.email, true); //unique
});
users.index('age', function(doc, emit){
  emit(doc.age); //can be non-unique
});

users.readStream({ index: 'age', gt: 15 }); //Stream users age over 15
users.readStream({ index: 'email', eq: 'adrian@cshum.com' }); //Stream user of email 'adrian@cshum.com'
```
##### Mapping & filtering
##### Prefixing
### Replication

Rodabase supports multi-master replication using vector clocks.

Linearizable consistency can be achieved using [Transaction](#transaction) for local operations, but this is impossible under a multi-master environment.
Many existing replication mechanism provides eventual consistency, which does not guarantee write ordering and unintuitive conflict resolution.

Rodabase preserves **Causal+** - causal consistency with convergent conflict handling.
This is achieved by 

* Maintaining partial ordering using Lamport timestamp.
* Keeping track nearest gets-from dependency.
* Replication queue that commits write only when causal dependencies has been satisfied.

The implementation loosely follows the **COPS** approach as presented in the article: [Don’t Settle for Eventual: Scalable Causal Consistency for Wide-Area Storage with COPS](http://sns.cs.princeton.edu/projects/cops-and-eiger/). 

Rodabase does not provide replication transport. 
Instead it defines replication mechanism via Node.js object stream.
Transports can be implemented based on application needs, such as [socket.io transport](https://github.com/cshum/roda-replicate-socketio) for realtime changing documents.

```js
var a = roda('a');
var b = roda('b');

//a replicate to b
b.clockStream()
  .pipe(a.changesStream({ live: true }))
  .pipe(b.replicateStream());

//b replicate to a
a.clockStream()
  .pipe(b.changesStream({ live: true }))
  .pipe(a.replicateStream());
```

#### .clockStream()

Readable stream for [Lamport clocks](http://en.wikipedia.org/wiki/Lamport_timestamps) of the Roda.
Everytime a write operation is committed its logical clock is incremented.

#### .changesStream([options])

#### .replicateStream([options])

Changes will be queued up until `_after` matches destination timestamp.

### Conflict Resolution

#### .use('conflict', [hook...])

### Timeline

#### .timeStream([options])

#### .trigger(job, [options])

