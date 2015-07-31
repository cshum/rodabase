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
  - [.readStream([options])](#readstreamoptions)
  - [.rebuildIndex([tag], [cb])](#rebuildindextag-cb)
- [Replication](#replication)
  - [.clockStream()](#clockstream)
  - [.changesStream([options])](#changesstreamoptions)
  - [.replicateStream([options])](#replicatestreamoptions)
- [Reactive](#reactive)
  - [.trigger(name, job, [options])](#triggername-job-options)
  - [.liveStream()](#livestream)
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
Optionally bind to a [transaction](#transaction) instance `tx`.

### Transaction
Transactions in Rodabase guarantee linearizable consistency for local operations, which 
avoids unexpected behavior and simplifies application development.

LevelDB supports atomic batched operations,
while durability is configurable via `sync` [option](https://github.com/Level/levelup#options-1) of LevelDB.
Rodabase leverages [level-transactions](https://github.com/cshum/level-transactions) for two-phase locking and snapshot isolation, which makes it ACID compliant.

#### roda.transaction()

Creates a new transaction instance. `get()`, `put()`, `del()` methods can be binded to the transaction instance, to perform operations in a sequential, atomic, isolated manner.
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
`validation` invoked at the beginning of a write operation. Result can be validated and changes can be made before the document is locked.

Context object consists of the following properties:
* `result`: Result document before locking. Changes can be made during this stage.

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
* `current`: Current state of document. `null` if this is an insert.
* `result`: Resulting document. `null` if this is a delete.
* `transaction`: Transaction instance. Additional operations can be binded.

```js
var data = roda('data');
var logs = roda('logs');

data.use('diff', function(ctx){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result ? ctx.result.n : 0;

  //Transaction works across sections
  logs.post({ delta: to - from }, ctx.transaction);
});

var tx = Roda.transaction();
data.put('bob', { n: 6 }, tx);
data.put('bob', { n: 8 }, tx);
data.put('bob', { n: 9 }, tx);
data.del('bob', tx);

tx.commit(function(){
  logs.readStream().pluck('delta').pipe(...); //[6, 2, 1, -9]
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
* `unique` boolean, specify . Default false.

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

roda('users').readStream({
  index: 'email', 
  eq: 'test@example.com' //user of email 'test@example.com'
}).toArray(function(list){
  //since email is unique, list has at most 1 element.
});

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

#### .rebuildIndex([tag], [cb])

Indexes need to be rebuilt when `registerIndex()` *after* a document is committed, or when `mapper` function has changed.

`rebuildIndex()` will rebuild *all* registered index within the roda section. Optionally specify `tag` so that indexes will only get rebuilt when `tag` has changed.

```js
users.rebuildIndex('1.1', function(){
  //indexes 1.1 rebuilt successfully.
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

### Reactive

Rodabase is reactive, live updates can be subscribed using streams and triggers. Updates are emitted *after* successful commits, so that it is both consistent and durable.

#### .trigger(name, job, [options])

Triggers an `name` named asynchronous `job` function every time *after* a document is committed. 

`job` is provided with document object and callback function `function(doc, callback){ }`, `callback` must be invoked when job has finished.

Job must be idempotent. 
If job callback with error argument, 
or if the process crashes before job callback, 
it will be rerun until callback success. 
`options` accepts following properties:

* `parallel` specify maximum number of parallel jobs to be triggered. Defaults 1.
* `retryDelay` number of milliseconds for delaying job rerun after callback error. Defaults 500.

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
}, {
  parallel: 3 //maximum 3 concurrent sendMail()
});
```

#### .liveStream()
Obtain a never-ending ReadStream for real-time updates of documents.

```js
roda('users').liveStream()
  .filter(function(doc){
    return doc.age > 15;
  })
  .each(function(doc){
    //receive live updates of user age over 15
  })
```

#### .historyStream([options])

