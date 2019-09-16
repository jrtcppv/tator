let window = self;

// Import tus.
importScripts("/static/js/tus.min.js");

// Import sparkmd5.
importScripts("/static/js/md5.min.js");

// Import uuid.
importScripts("/static/js/node-uuid.js");

// UID for this service worker.
const serviceWorkerId = uuidv1();
console.log("This service worker's UID: " + serviceWorkerId);

// List of uploads in progress.
let activeUploads = {};
const maxUploads = 1;

// Buffer of uploads.
let uploadBuffer = [];

// Define function for sending message to client.
const emitMessage = msg => {
  self.clients.matchAll({includeUncontrolled: true})
  .then(clients => {
    for (const client of clients) {
      client.postMessage(msg);
    }
  });
};

// Add an event listener that saves the upload info in the buffer.
self.addEventListener("message", async msgEvent => {
  let msg = msgEvent.data;
  if (msg.command == "addUpload") {
    console.log("Received upload request for file " + msg.file.name);
    const upload_uid = SparkMD5.hash(msg.file.name + msg.file.type + msg.username);
    uploadBuffer.push({...msg, uid: upload_uid});
    startUpload();
    fetch("/rest/UploadProgress/" + msg.projectId, {
      method: "POST",
      headers: {
        "Authorization": "Token " + msg.token,
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        gid: msg.gid,
        uid: upload_uid,
        swid: serviceWorkerId,
        section: msg.section,
        name: msg.file.name,
        state: "queued",
        message: "Queued...",
        progress: 0,
      }),
      credentials: "omit",
    })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(err => console.log("Error while broadcasting progress:" + err));
  } else if (msg.command == "getNumUploads") {
    console.log("Received get num uploads request.");
    const numActive = Object.keys(activeUploads).length;
    const numBuffered = uploadBuffer.length;
    const numUploads = numActive + numBuffered;
    console.log("Responding with " + numUploads + " uploads.");
    emitMessage({msg: "numUploads", count: numUploads});
  } else if (msg.command == "wake") {
    console.log("Received wake request...");
    startUpload();
  } else if (msg.command == "cancelUpload") {
    if (msg.uid in activeUploads) {
      activeUploads[msg.uid].cancel();
    } else {
      // Get the record and use it to send failure message.
      const record = uploadBuffer.find(elem => {return elem.uid == msg.uid});
      if (typeof record !== "undefined") {
        const index = uploadBuffer.indexOf(record);
        uploadBuffer.splice(index);
        fetch("/rest/UploadProgress/" + record.projectId, {
          method: "POST",
          headers: {
            "Authorization": "Token " + record.token,
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            gid: record.gid,
            uid: record.uid,
            swid: serviceWorkerId,
            section: record.section,
            name: record.file.name,
            state: "failed",
            message: "Aborted!",
            progress: 100,
          }),
          credentials: "omit",
        })
        .then(response => response.json())
        .then(data => console.log(data))
        .catch(err => console.log("Error attempting while broadcasting progress:" + err));
      }
    }
  }
});

// Define function for starting an upload.
function startUpload() {
  // Begin uploading the files.
  const belowMax = Object.keys(activeUploads).length < maxUploads;
  const haveUploads = uploadBuffer.length > 0;
  if (belowMax && haveUploads) {
    // Grab uploads from buffer.
    const upload = uploadBuffer.shift();
    if (!(upload.uid in activeUploads)) {
      // Start the upload.
      activeUploads[upload.uid] = new Upload(
        upload.file,
        upload.projectId,
        upload.gid,
        upload.section,
        upload.mediaTypeId,
        upload.username,
        upload.token,
      );
      activeUploads[upload.uid].computeMd5();
    }
  }
}

// Removes upload from list of active uploads.
function removeFromActive(uid) {
  if (uid in activeUploads) {
    delete activeUploads[uid];
  }
  startUpload();
}

// Manages an upload.
class Upload {

  constructor(file, projectId, gid, section, mediaTypeId, username, token) {
    // Fingerprint function for TUS client.
    this.uploadUid = function(uname) {
      return function(file, options) {
        return SparkMD5.hash(file.name + file.type + uname);
      };
    }(username);

    this.start_time = Date.now();
    this.file = file;
    this.projectId = projectId;
    this.gid = gid;
    this.section = section;
    this.mediaTypeId = mediaTypeId;
    this.username = username;
    this.token = token;
    this.upload_uid = this.uploadUid(file, null);
    this.aborted = false;

    // Create a list item with progress bar.
    this.md5 = "";
    this.fname = file.name;

    // Create a tus upload.
    this.tus_ep = self.location.origin + "/files/";
    console.log("Uploading to endpoint " + this.tus_ep)
    this.tus = new tus.Upload(this.file, {
      endpoint: this.tus_ep,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      fingerprint: this.uploadUid,
      metadata: {
        filename: this.file.name,
        filetype: this.file.type
      },
      chunkSize: 5242880, // 5MB
      onProgress: (bytesSent, bytesTotal) => {
        let percent = 100.0 * bytesSent / bytesTotal
        if (percent < 100) {
          let message = "Uploading..."
          this.progress("started", message, 10 + 0.4 * percent);
        }
      },
      onError: error => {
        console.log("Error during upload: " + error);
        removeFromActive(this.upload_uid);
        this.progress("failed", error, 100);
      },
      onSuccess: () => {
        // REST call initiating transcode.
        console.log("Completed upload!");
        fetch("/rest/Transcode/" + projectId, {
          method: "POST",
          headers: {
            "Authorization": "Token " + token,
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            type: this.mediaTypeId,
            gid: this.gid,
            uid: this.upload_uid,
            url: this.tus.url,
            section: this.section,
            name: this.tus.file.name,
            mimetype: this.tus.file.type,
            md5: this.md5,
          }),
          credentials: "omit",
        })
        .then(response => response.json())
        .then(data => console.log(data))
        .catch(err => console.log("Error attempting to initiate transcode:" + err));
        removeFromActive(this.upload_uid);
        this.progress("started", "Uploaded...", 50);
      }
    });

  }

  // Sends progress messages.
  progress(state, msg, pct) {
    fetch("/rest/UploadProgress/" + this.projectId, {
      method: "POST",
      headers: {
        "Authorization": "Token " + this.token,
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        gid: this.gid,
        uid: this.upload_uid,
        swid: serviceWorkerId,
        section: this.section,
        name: this.fname,
        state: state,
        message: msg,
        progress: pct,
      }),
      credentials: "omit",
    })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(err => console.log("Error attempting while broadcasting progress:" + err));
  }

  // Calculates md5 hash.
  computeMd5() {
    let blobSlice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice;
    const chunkSize = 2097152; // 2MB
    const chunks = Math.ceil(this.file.size / chunkSize);
    let currentChunk = 0;
    let spark = new SparkMD5.ArrayBuffer();
    let reader = new FileReader();
    reader.onload = async (e) => {
      spark.append(e.target.result);
      currentChunk++;
      const percentage = (currentChunk / chunks * 10).toFixed(2);
      if (currentChunk < chunks) {
        loadNext();
        if (currentChunk % 20 === 0) {
          this.progress("started", "Checking...", percentage);
        }
      } else {
        this.md5 = spark.end();
        fetch(
            "/rest/EntityMedias/" + this.projectId + "?format=json&type=" + 
            this.mediaTypeId + "&md5=" + this.md5)
          .then(response => response.json())
          .then(json => {
            console.log("Matching media entities: " + JSON.stringify(json));
            if (json.length === 0) {
              this.tus.start();
            } else {
              console.log("File has already been uploaded!");
              removeFromActive(this.upload_uid);
              this.progress("failed", "Already uploaded!", 0);
            }
          });
      }
    };
    reader.onerror = error => {
      console.log("Error processing MD5");
      removeFromActive(this.upload_uid);
      this.progress("failed", error, 0);
    };
    const loadNext = () => {
      if (this.aborted) {
        console.log("Caught abort in md5 check!");
        return;
      }
      var start = currentChunk * chunkSize;
      var end = ((start + chunkSize) >= this.file.size) ? this.file.size : start + chunkSize;
      reader.readAsArrayBuffer(blobSlice.call(this.file, start, end));
    }
    loadNext();
  }

  // Cancels an upload.
  cancel() {
    this.aborted = true;
    if (this.tus._source) {
      this.tus.abort();
    }
    removeFromActive(this.upload_uid);
    this.progress("failed", "Upload was aborted!", 0);
  }
}

