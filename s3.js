const loopback = require('loopback');
const url = require('url');
const AWS = require('aws-sdk');
const {s3Parameters} = loopback.wpms;
const s3 = new AWS.S3({
    accessKeyId: s3Parameters.accessKeyId,
    secretAccessKey: s3Parameters.secretAccessKey
});

class Adapter {

    deleteFile(filename, cb) {
        /* For more information about s3-methods/params go to the link bellow
         *  http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#createMultipartUpload-property
         */
        let params = {
            Bucket: s3Parameters.bucket,
            Key: filename
        };
        s3.deleteObject(params, (err, data) => {
            if (err) return cb(err);
            cb(null, data);
        });
    }

    uploadFile(file, mimetype, filename, fileModel, cb) {

        let params = {
            Body: file,
            Bucket: s3Parameters.bucket,
            Key: filename,
            ContentType: mimetype
        };

        let reject = err => cb({err, filename});

        let resolve = data => {

            fileModel.name = data.Key;
            fileModel.type = mimetype;
            let path = data['Location'];
            //get host from url
            let {host} = url.parse(path);

            //replace '*****.s3.amazonaws.com' with '*********.cloudfront.net'
            fileModel.location = path.replace(host, s3Parameters.domain);
            cb(null, fileModel);
        };

        s3
            .upload(params, (err, data) => err ? reject(err) : resolve(data))
            .on('httpUploadProgress', data => {
                /* Calls after each chunk is sent (min chunk size 5Mb)
                 * returns:  loaded:         Number,
                 *           total:          Number,
                 *           part:           Number,
                 *           key:            String
                 */
                fileModel.size = data.total;
            });
    }
}

module.exports = Adapter;
