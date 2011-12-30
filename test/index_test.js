var assert = require("assert");
var fs = require("fs");
var {Worker} = require("ringo/worker");
var {Semaphore} = require("ringo/concurrent");
var {Index} = require("../lib/index");
var {FSDirectory, RAMDirectory} = org.apache.lucene.store;
var {Document, Field} = org.apache.lucene.document;
var {StandardAnalyzer} = org.apache.lucene.analysis.standard;
var {Version} = org.apache.lucene.util;
var File = java.io.File;

var getTempDir = function() {
    var tempDir = new File(java.lang.System.getProperty("java.io.tmpdir"),
            "index" + java.lang.System.nanoTime());
    if (!tempDir.mkdir()) {
        throw new Error("Unable to create temporary index directory: " +
                tempDir.getAbsolutePath());
    }
    return tempDir;
};

var waitFor = function(callback) {
    var timeout = java.lang.System.currentTimeMillis() + 2000;
    while (callback() == false) {
        if (java.lang.System.currentTimeMillis() < timeout) {
            java.lang.Thread.currentThread().sleep(100);
        } else {
            throw new Error("Timeout");
        }
    }
    return true;
};

var getSampleDocument = function(value) {
    var doc = new Document();
    doc.add(new Field("id", value || 0,
             Field.Store.YES, Field.Index.ANALYZED, Field.TermVector.NO));
    return doc;
};

exports.testInitRamDirectory = function() {
    var dir = Index.initRamDirectory();
    assert.isNotNull(dir);
    assert.isTrue(dir instanceof RAMDirectory);
};

exports.testInitDirectory = function() {
    var tempDir = getTempDir();
    var dir = Index.initDirectory("test", tempDir);
    assert.isNotNull(dir);
    assert.isTrue(dir instanceof FSDirectory);
    tempDir["delete"]();
};

exports.testConstructor = function() {
    var manager = Index.createRamIndex();
    assert.isNotNull(manager);
    assert.isNotNull(manager.writer);
    assert.isNotNull(manager.reader);
    assert.isNotNull(manager.searcher);
    manager.close();
};

exports.testSize = function() {
    var manager = Index.createRamIndex();
    assert.strictEqual(manager.size(), 0);
    manager.close();
};

exports.testConcurrentAsyncAdd = function() {
    var manager = Index.createRamIndex();
    // check size just to create a reader
    assert.strictEqual(manager.size(), 0);

    // starting 10 workers, each adding 10 documents
    var nrOfWorkers = 10;
    var docsPerWorker = 3;
    var docs = nrOfWorkers * docsPerWorker;
    var semaphore = new Semaphore();
    for (var i=0; i<nrOfWorkers; i+=1) {
        var w = new Worker({
            "onmessage": function(event) {
                var workerNr = event.data;
                for (var i=0; i<docsPerWorker; i+=1) {
                    manager.add(getSampleDocument((workerNr * 10) + i));
                }
                semaphore.signal();
            }
        });
        w.postMessage(i);
    }
    // wait for all workers to finish
    semaphore.wait(nrOfWorkers);
    // wait until the async adds have finished
    waitFor(function() {
        return manager.size() == docs;
    });
    assert.strictEqual(manager.size(), docs);
    manager.close();
};

exports.testConcurrentAsyncRemove = function() {
    var manager = Index.createRamIndex();
    assert.strictEqual(manager.size(), 0);

    var nrOfWorkers = 10;
    var docsPerWorker = 3;
    var docs = [];
    for (var i=0; i<nrOfWorkers; i+=1) {
        for (var j=0; j<docsPerWorker; j+=1) {
            docs.push(getSampleDocument((i * 10) + j));
        }
    }
    manager.add(docs);
    waitFor(function() {
        return manager.size() == docs.length;
    });
    assert.strictEqual(manager.size(), docs.length);

    // starting 10 workers, each removing 10 documents
    var semaphore = new Semaphore();
    for (var i=0; i<nrOfWorkers; i+=1) {
        var w = new Worker({
            "onmessage": function(event) {
                var workerNr = event.data;
                for (var i=0; i<docsPerWorker; i+=1) {
                    manager.remove("id", (workerNr * 10) + i);
                }
                semaphore.signal();
            }
        });
        w.postMessage(i);
    }
    // wait for all workers to finish
    semaphore.wait(nrOfWorkers);
    waitFor(function() {
        return manager.size() == 0;
    });
    assert.strictEqual(manager.size(), 0);
    manager.close();
};