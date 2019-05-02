const loopback = require('loopback');
const wpError = loopback.wpms.wpError();
const Busboy = require('busboy');
const R = require('ramda');
class FileEmitter extends (require('events')) {}

let adapter = new (require('./s3'))();

module.exports = FileManager => {

    // This hook first removes file data from adapter. By success it'll remove data from db.
    FileManager.observe('before delete', (ctx, cb) => {
        //find name of deleting instance
        FileManager.findOne({where: ctx.where}, (err, instance) => {
            if (err || !instance) {
                //or some custom error
                return cb(err);
            }
            adapter.deleteFile(instance.name, cb);
        });
    });

    let _getPrefix = ctx => {
        // here might be some logic for getting prefix name and some validation functionality

        /**
         * this function fires one of the following events
         *
         * SUCCESS
         *
         * ctx.fileCounter.emit('validationFinished', {
         *       prefix: ctx.prefix,
         *       data: {
         *           resellerId: requester.resellerId,
         *           userId: ctx.context.userId
         *       }
         *   });
         *
         * FAIL
         *
         *  ctx.fileCounter.emit('validationFailed', err);
         *
         *
         *
         *
         */
        someValidationFunction(ctx);
    };

    let _createOrUpdateFile = (fileModel, fileCounter) => {
        let filter = {
            skipAutomaticContext: true,
            where: {name: fileModel.name}
        };
        FileManager.findOrCreate(filter, fileModel, (err, instance, created) => {
            if (err) {
                fileCounter.emit('createFailed', {
                    filename: fileModel.name,
                    err
                });
            } else if (!err && false === created) {
                // File model exists
                instance.updateAttributes(fileModel, (err, updatedInstance) => {
                    if (err) {
                        fileCounter.emit('createFailed', {
                            filename: fileModel.name,
                            err: err
                        });
                    } else {
                        fileCounter.emit('createFinished', {
                            filename: updatedInstance.name,
                            details: updatedInstance
                        });
                    }
                });
            } else {
                //File model created successfully
                fileCounter.emit('createFinished', {
                    filename: instance.name,
                    details: instance
                });
            }
        });
    };

    FileManager.upload = (req, res, cb) => {

        let response = [],
            fileModel,
            isPrefixReady = false,
            prefixFileName,
            finishedFiles = 0,
            totalFiles = 0,
            allFilesSent = false;

        let fileCounter = new FileEmitter();

        // CUSTOM LISTENERS ---------------------> START

        //Step-1. Listen for the event when refValidator finish to validate the requested data
        fileCounter.on('validationFinished', result => {
            fileModel = result.data;
            prefixFileName = result.prefix;
            isPrefixReady = true;
            fileCounter.emit('prefixReady');
        });

        /* Step-1. Listen for event when upload-validator throw an error
         * if error was thrown - finish upload with received error
         */
        fileCounter.on('validationFailed', cb);

        /* Step-2. File is uploaded successfully
         * call the function for creating model in db
         */
        fileCounter.on('uploadFinished', model => _createOrUpdateFile(model, fileCounter));

        //Step-2. File was not uploaded because of error
        fileCounter.on('uploadFailed', ({err, filename}) => {
            // console.log('upload failed for file: ', filename);
            finishedFiles++;
            response.push({[filename]: err});
            if (allFilesSent && (totalFiles === finishedFiles)) {
                fileCounter.emit('end');
            }
        });

        //Step-3. File model was successfully created in db
        fileCounter.on('createFinished', ({filename, details}) => {
            // console.log('file created successfully: ', filename);
            finishedFiles++;
            response.push({[filename]: details});
            if (allFilesSent && (totalFiles === finishedFiles)) {
                fileCounter.emit('end');
            }
        });

        //Step-3. File model was not created in db because of error
        fileCounter.on('createFailed', ({err, filename}) => {
            // console.log('file uploaded, but creating returned error: ', err);
            finishedFiles++;
            response.push({[filename]: err});
            if (allFilesSent && (totalFiles === finishedFiles)) {
                fileCounter.emit('end');
            }
        });

        //Step-4. Uploading finished
        fileCounter.on('end', () => cb(null, response));

        // CUSTOM LISTENERS ---------------------> END

        /* Get prefix name for uploading files
         * The function calls events depending on result of validation
         * Provide needed context to validation function
         */

        _getPrefix({fileCounter});

        // Create Busboy instance passing the HTTP Request headers.
        let busboy = new Busboy({
            headers: req.headers
        });

        // Pipe the HTTP Request into Busboy.
        req.pipe(busboy);

        // Listen for the event when Busboy finish to parse the form.
        busboy.on('finish', () => {
            allFilesSent = true;
        });

        // Listen for event when Busboy find a file to stream.
        busboy.on('file', (fieldName, fileStream, filename, encoding, mimeType) => {
            totalFiles++;

            let fullFileName;

            let callbackAdapter = (err, model) => err ?
                fileCounter.emit('uploadFailed', err) :
                fileCounter.emit('uploadFinished', model);// jshint ignore:line

            if (isPrefixReady === true) {
                fullFileName = prefixFileName + filename;
                adapter.uploadFile(fileStream, mimeType, fullFileName, fileModel, callbackAdapter);
            } else {
                fileCounter.on('prefixReady', () => {
                    fullFileName = prefixFileName + filename;
                    adapter.uploadFile(fileStream, mimeType, fullFileName, fileModel, callbackAdapter);
                });
            }
        });
    };

    FileManager.remoteMethod('upload', {
        accepts: [
            {arg: 'req', type: 'object', 'http': {source: 'req'}},
            {arg: 'res', type: 'object', 'http': {source: 'res'}}
        ],
        returns: {type: 'array', root: true},
        http: {path: '/upload', verb: 'post'}
    });
};
