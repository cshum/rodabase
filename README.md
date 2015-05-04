#Rodabase

JavaScript transactional document store. Built on [LevelDB](https://github.com/rvagg/node-levelup).
* [Stream](http://highlandjs.org/) and [middleware](https://github.com/cshum/ginga) based asynchronous API.
* Schemaless by default, constraint when needed.
* Transactions guarantee linearizable local operations.
* [Casual+ consistency](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf) preserving replication mechanism.
* Flexible [storage backends](https://github.com/level/levelup/wiki/Modules#storage-back-ends). Works on Node.js or browser.

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)

```bash
$ npm install rodabase leveldown
```
[LevelDOWN](https://github.com/rvagg/node-leveldown) is the default backend store for LevelDB. 

**License** MIT

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
##API

- [Basics](#basics)
  - [rodabase(path, [options])](#rodabasepath-options)
  - [roda(name)](#rodaname)
  - [.put([id], doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
- [Index](#index)
  - [.index(name, mapper)](#indexname-mapper)
  - [.readStream([options])](#readstreamoptions)
- [Transaction](#transaction)
  - [roda.transaction()](#rodatransaction)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
- [Changes](#changes)
  - [.clockStream()](#clockstream)
  - [.liveStream()](#livestream)
  - [.changeStream([options])](#changestreamoptions)
- [Replication](#replication)
  - [.mergeStream()](#mergestream)
  - [.use('conflict', [hook...])](#useconflict-hook)
  - [.pipe(roda)](#piperoda)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

###Basics
####rodabase(path, [options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```

####roda(name)

All operations are asynchronous although they don't necessarily require a callback.

####.put([id], doc, [tx], [cb])
Inserting, updating data into Rodabase. 

* `id`:  Primary key under namespace. Must be a string. Will auto generate a unique ID if not specifying one.
* `doc`: Resulting document. Must be a JSON serializable object.
* `tx`: Optional transaction object. See [Transaction](#transaction) section.

```js
//specify _id
roda('stuff').put('bob', { foo: 'bar' });

//auto generated _id
roda('stuff').put({ foo: 'bar' }, function(err, res){
  if(err) 
    return console.error('Error: ', err);

  console.log(res);
}); 

```
Auto generated _id is a 20 chars, URL-safe, base64 time sorted unique ID.

Example result:
```json
{ 
  "_id": "FZBJIBTCaLEJk8924J0A",
  "foo": "bar", 
  "_rev": "k8924J0AFZ"
} 

```

####.get(id, [tx], [cb])
Fetching data from Rodabase.

* `id`: Primary key under the namespace. Must be a string.
* `tx`: Optional transaction object. See [Transaction](#transaction) section.

Callback value returns document object.
If it doesn't exist in the store then the callback will receive a `null` value.

####.del(id, [tx], [cb])
Removes data from Rodabase.

* `id`: Primary key under the namespace. Must be a string.
* `tx`: Optional transaction object. See [Transaction](#transaction) section.

###Index
####.index(name, mapper)
#####emit(key, [doc], [unique])

```js
var users = roda('users');

users.index('email', function(doc, emit){
  emit(doc.email, true); //unique
});
users.index('age', function(doc, emit){
  emit(doc.age); //non-unique
});

users.readStream({ index: 'age', gt: 15 }); //users over age 15

```
####.readStream([options])
* `index`
* `options`
  * `prefix`
  * `gt`
  * `gte`
  * `lt`
  * `lte`
  * `eq`

###Transaction

Rodabase manages transaction states in asynchronous, isolated manner. Rodabase is ACID compliant:

* **Atomicity**: Transactions complete either entirely or no effect at all. Inherent feature of [batched operations](https://github.com/rvagg/node-levelup#dbbatcharray-options-callback-array-form) in LevelDB.
* **Consistency**: Rodabase allows fine-grain control over data integrity, validations, logging, consistently throughout the application.
* **Isolation**: States of transactions are isolated until successful commits.
* **Durability**: Committed transactions are persistent. The amount of durability is [configurable](https://github.com/rvagg/node-levelup#dbputkey-value-options-callback) as a LevelDB option.

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
At `diff` stage, access to document and namespace clock is acquired.
Current and resulting document can be compared for additional log, diff related operations.

`hook` is a [Ginga middleware](https://github.com/cshum/ginga#middleware) function. 
Context object consists of the following properties:
* `ctx.current`: Current state of document. `null` if this is an insert.
* `ctx.result`: Resulting document. `ctx.result._deleted === true` if this is a delete. Unlike `validation` hook, resulting document cannot be modified at this stage.
* `ctx.transaction`: Transaction instance. Additional operations can be attached.

```js
var count = roda('count');
var log = roda('log');

count.use('diff', function(ctx, next){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result.n || 0;

  //Transaction works across namespaces.
  log.put({ delta: to - from }, ctx.transaction);

  next();
});

var tx = Roda.transaction();
count.put('bob', { n: 6 }, tx);
count.put('bob', { n: 8 }, tx);
count.del('bob', tx);

tx.commit(function(){
  log.readStream().pluck('delta').toArray(function(data){
    console.log(data); //[6, 2, -8]
  });
});
```

###Changes

Causal consistency ensures operations appear in the order the user intuitively expects. Three rules define potential causality:

1. **Execution Thread**: If `a` and `b` are two operations within a transaction, `a ~ b` if operation `a` happens before operation `b`.
2. **Gets From**: If `a` is a put operation and `b` is a get operation that returns the value written by a, then `a ~ b`.
3. **Transitivity**: For operations `a`, `b`, and `c`, if `a ~ b` and `b ~ c`, then `a ~ c`. Thus, the causal relationship between operations is the transitive closure of the first two rules.


####.clockStream()

Readable stream for [Lamport clocks](http://en.wikipedia.org/wiki/Lamport_timestamps) of the Roda.
Everytime a write operation is committed its logical clock is incremented.
In order to
`clockStream()` indicates 


####.liveStream()
####.changeStream([options])

###Replication
####.mergeStream()
```js
var a = roda('a');
var b = roda('b');
b.clockStream().pipe(a.changeStream()).pipe(b.mergeStream());
```
####.use('conflict', [hook...])
####.pipe(roda)
```js
//equivalent
roda('a').pipe('b');
roda('a').pipe(roda('b'));
roda('b').clockStream()
  .pipe(roda('a').changeStream({live: true}))
  .pipe(roda('b').mergeStream());
```
