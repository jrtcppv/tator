// Video class handles interactions between HTML presentation layer and the
// javascript application.
//

/// The video player uses seek+display strategy to an off-screen buffer.
///
/// The off-screen buffer is then copied to a buffer of GPU-backed
/// textures, whose depth is configurable by 'bufferDepth' variable in
/// 'loadFromURL'.
///
/// The 'playGeneric' routine is kicked off for forward/rewind activities
/// and drives to userspace threads.
/// - The Player runs at the display rate (guiFPS is the max, but nominal
///   displays at the video FPS).
/// - The Loader runs at the fastest rate a browser codec can seek+load the
///   frame buffer. Assuming the frame buffer fills faster than the display
///   the load thread retreats for half the buffer size to fill back up again.
/// - A diagnostic thread runs to report FPS to the javascript console.
///
/// Supported formats:
/// - The video player works with any codec the html5 video object in the
///   given browser supports. This is browser specific, but both Chrome
///   and firefox support the following formats:
///      + video/mp4 (codec: libx264)
///      + video/webm (codec: vp8)
///      + video/webm (codec: vp9)
///
///
/// Frame rate limiting:
/// - guiFPS is a way to limit the maximum attempted FPS. If a video with
///   an FPS faster than guiFPS is loaded, playback rate is lowered.
/// - Playback rate can be adjusted to 'fast forward'. Frame droppage
///   occurs when the fast forward FPS exceeds the GUI FPS.
///      + As an example if the guiFPS is 30, and you load a 15 FPS video
///        the FPS of playback rate 1.0 is 15. at 2.0, the FPS is 30. If
///        the user requests a playback rate of 4.0 the FPS is 60, but the
///        screen can only display 30 fps. In this case every other frame is
///        loaded + displayed (@ 30 fps).
///
/// Known issues/Erratta:
///
/// - We currently use the "source" access of the html5 object to a URL,
///   rather than using a MediaSource (with MSE). This simplifies the encoding
///   requirements of the video, but doesn't allow manual control of loading
///   the video or optomization of network traffic to/from the client.
///
/// - In order for the 'seek+play' strategy to work, videos need to have
///   fixed size GOP (i.e. number of frames per key frame region). This
///   aligns with notes on making videos 'streamable'. Videos should have
///   a key frame at least every 2 seconds for optimal performance. With
///   ffmpeg one can do something like `ffmpeg ... -r <fps> -g <fps*2>
///
/// - Performance in firefox is markedly less than Chrome which seems to have
///   a better implementation of handing `<video>`. On a XPS 15 9570 (2018 era)
///   the chrome browser was able to display video at 60 FPS. Firefox had
///   performance in the teens. On an XPS 15 (2008 era), Chrome performed
///   in the teens.

// Constrain the video display FPS to not allow dropped frames during playback
//
var guiFPS=30;

var Direction = { BACKWARDS:-1, STOPPED: 0, FORWARD: 1};
var State = {PLAYING: 0, IDLE: 1, LOADING: -1};

var src_path="/static/js/annotator/";

/// Support multiple off-screen videos
class VideoBufferDemux
{
  constructor(bufferSize, numBuffers)
  {
    // By default use 100 megabytes
    this._bufferSize = 100*1024*1024;
    this._numBuffers = 30;
    if (bufferSize)
    {
      this._bufferSize = bufferSize;
    }
    if (numBuffers)
    {
      this._numBuffers = numBuffers;
    }
    this._totalBufferSize = this._bufferSize*this._numBuffers;
    this._vidBuffers=[];
    this._inUse=[];
    this._full=[];
    this._mediaSources=[];
    this._sourceBuffers=[];
    this._compat = false;
    this._activeBuffers = 0;

    var makeSourceBuffer = function(idx, event)
    {
      var args=this;
      var ms = args["ms"];
      var idx = args["idx"];
      ms.onsourceopen=null;
      // Need to add a source buffer for the video.
      var mime_str='video/mp4; codecs="avc1.64001e"';
      that._sourceBuffers[idx]=ms.addSourceBuffer(mime_str);
    }
    var that = this;
    for (var idx = 0; idx < this._numBuffers; idx++)
    {
      this._vidBuffers.push(document.createElement("VIDEO"));
      this._inUse.push(0);
      this._full.push(false);
      var ms=new MediaSource();
      this._mediaSources[idx] = ms;
      this._sourceBuffers.push(null);
      this._vidBuffers[idx].src=URL.createObjectURL(this._mediaSources[idx]);
      ms.onsourceopen=makeSourceBuffer.bind({"idx": idx, "ms": ms});
    }
  }

  status()
  {
    console.info("Buffer Status");
    console.info(`Active Buffer Count = ${this._activeBuffers}`);
    var bufferSizeMb=this._bufferSize/(1024*1024);
    for (var idx = 0; idx < this._numBuffers; idx++)
    {
      var mbInUse=this._inUse[idx]/(1024*1024);
      console.info(`\t${idx} = ${mbInUse}/${bufferSizeMb} MB`);
      var ranges=this._vidBuffers[idx].buffered;
      if (ranges.length > 0)
      {
        console.info("\tRanges:");
        for (var rIdx = 0; rIdx < ranges.length; rIdx++)
        {
          console.info(`\t\t${rIdx}: ${ranges.start(rIdx)}:${ranges.end(rIdx)}`);
        }
      }
      else
      {
        console.info("\tEmpty");
      }

    }
  }

  currentVideo()
  {
    for (var idx = 0; idx < this._numBuffers; idx++)
    {
      if (this._full[idx] != true)
      {
        return this._vidBuffers[idx];
      }
    }
    return null;
  }

  forTime(time, direction)
  {
    if (this._compat)
    {
      return this._vidBuffers[0];
    }
    for (var idx = this._activeBuffers-1; idx >= 0; idx--)
    {
      var ranges = this._vidBuffers[idx].buffered;
      for (var rangeIdx = 0; rangeIdx < ranges.length; rangeIdx++)
      {
        var start=ranges.start(rangeIdx);
        var end = ranges.end(rangeIdx);
        if (time >= start &&
            time <= end)
        {
          return this._vidBuffers[idx];
        }
      }
    }

    return this._vidBuffers[0];
  }

  currentIdx()
  {
    for (var idx = 0; idx < this._numBuffers; idx++)
    {
      if (this._full[idx] != true)
      {
        return idx;
      }
    }
    return null;
  }

  error()
  {
    var currentVid = this.currentVideo();
    if (currentVid)
    {
      return currentVid.error;
    }
    else
    {
      return {code: 500, message: "All buffers full."};
    }
  }

  compat(videoUrl)
  {
    this._vidBuffers[0].src=videoUrl;
    this._vidBuffers[0].load();
    this._compat = true;
  }

  pause()
  {
    for (var idx = 0; idx < this._numBuffers; idx++)
    {
      this._vidBuffers[idx].pause();
    }
  }

  loadedDataPromise(video)
  {
    var that = this;
    var promise = new Promise(
      function(resolve,reject)
      {
        that._vidBuffers[0].onloadeddata = function()
        {
          video.gotoFrame(0);
          resolve();
          that._vidBuffers[0].onloadeddata = null;
        }
        that._vidBuffers[0].onerror = function()
        {
          reject();
          that._vidBuffers[0].onerror = null;
        }

        if (that._vidBuffers[0].readyState > 0)
        {
          resolve();
        }
      });
    return promise;
  }

  appendLatestBuffer(data, callback)
  {
    var latest=this.currentIdx();
    if (latest != null)
    {
      var newSize = this._inUse[latest] + data.byteLength;
      if (newSize > this._bufferSize)
      {
        console.log(`${latest} is full, proceeding to next buffer`);
        this._full[latest] = true;
        this.appendLatestBuffer(data, callback);
      }
      else
      {
        // If we are 2% away from the end, start overlapping
        // Except for the last buffer because then we are
        // SoL.
        if (newSize > (this._bufferSize *0.98) &&
            latest != (this._numBuffers - 1))
        {
          this._updateBuffers([latest,latest+1],data,callback);
        }
        else
        {
          this._updateBuffers([latest],data,callback);
        }
      }
    }
    else
    {
      console.error("No Buffers available!");
    }

  }

  _updateBuffers(buffersToUpdate, data, callback)
  {
    var semaphore = buffersToUpdate.length;
    var that = this;
    this._activeBuffers=Math.max(...buffersToUpdate)+1;
    var wrapper=function()
    {
      that._sourceBuffers[this].onupdateend=null;
      semaphore--;
      if (semaphore == 0)
      {
        callback();
      }
    };

    for (var idx = 0; idx < buffersToUpdate.length; idx++)
    {
      var bIdx = buffersToUpdate[idx];
      this._sourceBuffers[bIdx].onupdateend=wrapper.bind(idx);
      var error = this._vidBuffers[bIdx].error;
      if (error)
      {
        console.error("Error " + error.code + "; details: " + error.message);
        updateStatus("Video Decode Error", "danger", -1);
        return;
      }
      this._sourceBuffers[bIdx].appendBuffer(data);
      this._inUse[bIdx] += data.byteLength;
    }
  }

  appendAllBuffers(data, callback)
  {
    console.info(`VIDEO: Updating all buffers with ${data.byteLength}`)
    var semaphore = this._numBuffers;
    var wrapper = function()
    {
      semaphore--;
      if (semaphore==0)
      {
        callback();
      }
    }
    for (var idx = 0; idx < this._numBuffers; idx++)
    {
      this._sourceBuffers[idx].onupdateend=function()
      {
        this.onupdateend=null;
        wrapper();
      }
      this._sourceBuffers[idx].appendBuffer(data);
      this._inUse[idx] += data.byteLength;
    }
  }
}
class VideoCanvas extends AnnotationCanvas {
  constructor() {
    super();
    var that = this;
    // Make a new off-screen video reference
    this._videoElement=new VideoBufferDemux();

    this._playbackRate=1.0;
    this._dispFrame=null; //represents the currently displayed frame
    this._direction=Direction.STOPPED;
    this._fpsDiag=0;
    this._fpsLoadDiag=0;

    this._playCb = [this.onPlay.bind(this)];
    this._pauseCb = [this.onPause.bind(this)];
    
    // This flag is used to force a vertex reload
    this._dirty = true;
  }

  refresh()
  {
    return this.gotoFrame(this._dispFrame);
  }

  currentFrame()
  {
    return this._dispFrame;
  }

  startDownload(videoUrl)
  {
    var needToSeekTo0=2;
    var that = this;

    this._dlWorker = new Worker(`${src_path}/vid_downloader.js`);

    this._dlWorker.onmessage =
      function(e)
    {
      const type = e.data["type"];
      if (type == "finished")
      {
        console.info("Stopping download worker.");
        that._dlWorker.terminate();
      }
      else if (type =="buffer")
      {
        var error = that._videoElement.error();
        if (error)
        {
          updateStatus("Video decode error", "danger", "-1");
          return;
        }

        // recursive lamdba function to update source buffer
        var idx = 0;
        var offsets=e.data["offsets"];

        var data = e.data["buffer"];
        var appendBuffer=function(callback)
        {
          var offsets = e.data["offsets"];
          if (idx <  offsets.length)
          {
            if (offsets[idx][2] == 'ftyp')
            {
              var begin=offsets[idx][0];
              var end=offsets[idx+1][0]+offsets[idx+1][1];
              that._videoElement.appendAllBuffers(data.slice(begin, end), callback);
              idx+=2;
            }
            else
            {
              var begin=offsets[idx][0];
              var end=offsets[idx][0] + offsets[idx][1];
              that._videoElement.appendLatestBuffer(data.slice(begin, end), callback);
              idx++;
            }
          }
        };

        var afterUpdate = function(_)
        {
          var error = that._videoElement.error();
          if (error)
          {
            console.error("Error " + error.code + "; details: " + error.message);
            updateStatus("Video Decode Error", "danger", -1);
            return;
          }

          if (needToSeekTo0)
          {
            if (needToSeekTo0 == 0)
            {
              console.log("Seek to frame 0");
              that.seekFrame(0, that.drawFrame);
              needToSeekTo0 = -1;
            }
            else
            {
              needToSeekTo0--;
            }
          }
          that.dispatchEvent(new CustomEvent("bufferLoaded",
                                             {composed: true,
                                              detail: {"percent_complete":e.data["percent_complete"]}
                                             }));

          if (idx == offsets.length)
          {
            that._dlWorker.postMessage({"type": "download"});
          }
          else
          {
            // Can't call append in this event handler + avoid a deep recursion stack
            setTimeout(function()
                       {
                         appendBuffer(afterUpdate);
                       },0);
          }
        };

        appendBuffer(afterUpdate);

      }
      else if (type == "ready")
      {
        that._dlWorker.postMessage({"type": "download"});
      }
      else if (type == "error")
      {
        // Go to compatibility mode
        console.warn("In video compatibility mode");
        that._videoElement.compat(videoUrl);
        that.seekFrame(0, that.drawFrame);
        that.dispatchEvent(new CustomEvent("bufferLoaded",
                                           {composed: true,
                                            detail: {"percent_complete":1.00}
                                           }));
      }
    };
    this._dlWorker.postMessage({"type": "start", "url": videoUrl});
  }

  /// Load a video from URL (whole video) with associated metadata
  /// Returns a promise when the video resource is loaded
  loadFromURL(videoUrl, fps, numFrames, dims)
  {
    var that = this;
    // Resize the viewport
    this._draw.resizeViewport(dims[0], dims[1]);
    this._fps=fps;
    this._numFrames=numFrames;
    this._dims=dims;
    this.resetRoi();

    var promise = this._videoElement.loadedDataPromise(this);
    this.startDownload(videoUrl);
    if (fps > guiFPS)
    {
      this._playbackRate=guiFPS/fps;
      this.rateChange(this._playbackRate);
      var msg = "Loading a video with faster framerate than supported then display.\n";
      msg+= "Adjusting playrate to avoid dropping frames.\n";
      msg+= "\tDisplay FPS=" + guiFPS + "\n";
      msg+= "\tVideo FPS=" + fps + "\n";
      msg+= "\tPlayrate = " + this._playbackRate;
      console.warn(msg);
    }

    // Set up slider max + scrub thresholds
    //this._slider.slider("option", "max", numFrames);
    this.scrubThreshold = Math.max(25,numFrames/200);
    this._draw.resizeViewport(dims[0], dims[1]);
    this.setupResizeHandler(dims);
    // On load seek to frame 0
    return promise;
  }

  clearFrame()
  {
    var cWidth=this._canvas.width;
    var cHeight=this._canvas.height;
    this._draw.clearRect(0,0,cWidth, cHeight);

    //Clear the buffer too
    this._draw.clear();

    this._dispFrame=null;
  }

  // Update the canvas (immediate) with the source material, centered on
  // the view screen (resets GPU-bound frame buffer)
  // holds the buffer
  drawFrame(frameIdx, source, width, height)
  {
    // Need to draw the image to the viewable size of the canvas
    // .width is actually the rendering width which may be different
    // in high DPI monitors.
    var cWidth=this._draw.clientWidth;
    var cHeight=this._draw.clientHeight;
    // Calculate scaled image height, such that
    // the height matches the height of the viewscreen
    // and set the scaled width accordingly to maintain aspect
    var scale=cHeight/height;
    var sHeight=height*scale;
    var sWidth=width*scale;

    // Calculate the margin we have in width
    var margin=cWidth-sWidth;
    // We want half of the margin to the left of the image frame
    var leftSide=margin/2;

    // Handle the buffer synchronously because we are seeking in this
    // function. Clear the pipeline, Push the latest image, and display
    this._draw.clear();
    this._draw.pushImage(frameIdx,
                         source,
                         this._roi[0],this._roi[1],
                         this._roi[2],this._roi[3], //Image size
                         leftSide,0, //Place 'full-screen'
                         sWidth,sHeight, // Use canvas size
                         this._dirty
                        );
    this._dirty=false;

    this.displayLatest(true);
    this.updateOffscreenBuffer(frameIdx,
                               source,
                               width,
                               height);

  }

  /// Only call this function from the context of an animation frame
  /// Only call this function if the drawing context can play.
  displayLatest(hold)
  {
    this._fpsDiag++;
    this._dispFrame=this._draw.dispImage(hold);

    this.dispatchEvent(new CustomEvent("frameChange", {
      detail: {frame: this._dispFrame},
      composed: true
    }));
  }

  // Push a given frame into the drawGL buffer
  pushFrame(frameIdx, source, width, height)
  {
    var cWidth=this._canvas.width;
    var cHeight=this._canvas.height;
    // Calculate scaled image height, such that
    // the height matches the height of the viewscreen
    // and set the scaled width accordingly to maintain aspect
    var scale=cHeight/height;
    var sHeight=height*scale;
    var sWidth=width*scale;

    // Calculate the margin we have in width
    var margin=cWidth-sWidth;
    // We want half of the margin to the left of the image frame
    var leftSide=margin/2;

    this._draw.pushImage(frameIdx,
                         source,
                         this._roi[0],this._roi[1],
                         this._roi[2],this._roi[3], //Image size
                         leftSide,0, //Place 'full-screen'
                         sWidth,sHeight, // Use canvas size
                         this._dirty
                        );
    this._dirty=false;
  }

  /// Returns the raw HTML5 buffer for a given frame (default current)
  /// TODO: Add strategy for multires
  videoBuffer(frame)
  {
    if (frame == undefined)
    {
      frame = this.currentFrame();
    }
    var time=((1/this._fps)*frame)+(1/(this._fps*4));
    var direction = this._direction;
    if (direction == Direction.STOPPED)
    {
      if (frame > this.currentFrame())
      {
        direction = Direction.FORWARD;
      }
      else
      {
        direction = Direction.BACKWARD;
      }
    }
    return this._videoElement.forTime(time, direction);
  }
  /// Seeks to a specific frame of playback and calls callback when done
  /// with the signature of (data, width, height)
  seekFrame(frame, callback)
  {
    var that = this;
    var time=((1/this._fps)*frame)+(1/(this._fps*4));
    var video=this.videoBuffer(frame);

    if (time <= video.duration)
	  {
	    video.currentTime=time;

	  }
	  else if (time > video.duration)
	  {
	    var end = video.duration;
	    time = end;
	    frame = end*this._fps;
	    video.currentTime=end;
	  }
	  else
	  {
	    time = 0;
	    frame=0;
	    video.currentTime=0;
	  }

    var promise = new Promise(
      function(resolve,reject)
	    {
	      // Because we are using off-screen rendering we need to defer
	      // updating the canvas until the video/frame is actually ready, we do this
	      // by waiting for a signal off the video + then scheduling an animation frame.
	      video.oncanplay=function()
	      {
	        // Don't do anything busy in the canplay interrupt as it holds up the GUI
	        // rasterizer.
	        // Need to bind the member function to the result handler
	        callback=callback.bind(that);
	        callback(frame, video, that._dims[0], that._dims[1])
	        resolve();
	        video.oncanplay=null;
	      };
	    });
	  return promise;
  }

  ////////////////////////////////
  /// Button handlers
  ////////////////////////////////
  rateChange(newRate)
  {
	  this._playbackRate=newRate;
    this.dispatchEvent(new CustomEvent("rateChange", {
      detail: {rate: newRate},
      composed: true,
    }));
  }

  processRateChange(event)
  {
	  this._playbackRate=this._controls.rateControl.val();
	  console.log("set rate to: " + this._playbackRate);
	  return false;
  }

  gotoFrame(frameIdx)
  {
	  if (this._direction != Direction.STOPPED)
	  {
	    return;
	  }
    
    var promise = this.seekFrame(parseInt(frameIdx), this.drawFrame);
    promise.then(()=>
                 {this._pauseCb.forEach(cb => {cb(frameIdx);});}
                );
	  return promise;
  }

  captureFrame(localizations,frame)
  {
    if (frame == undefined)
    {
      frame = this.currentFrame()
    }

    const filename = `Frame_${frame}_${this._mediaInfo['name']}`;
    this.makeOffscreenDownloadable(localizations, filename);
  }

  _playGeneric(direction)
  {
	  var that = this;
    this._direction=direction;

	  // Reset the GPU buffer on a new play action
	  this._draw.clear();

	  /// This is the notional scheduled diagnostic interval
	  var schedDiagInterval=2000.0;

	  // set the current frame based on what is displayed
	  var currentFrame=this._dispFrame;

	  // Interval is either the frame rate interval of the playback/fps
	  // or the underlying GUI frame rate interval
	  var videoInterval=(1000/this._fps)*(1/this._playbackRate);
	  var fpsInterval=Math.max(videoInterval, (1000/guiFPS));
	  var skipInterval=Math.round((fpsInterval/videoInterval));
	  if (skipInterval >  1)
	  {
	    console.info("Playback rate exceeds guiFPS, skipping " + skipInterval + " frames per cycle");
	  }

	  // This is the time to wait to start playing when the buffer is dead empty.
	  // 2 frame intervals gives the buffer to fill up a bit to have smooth playback
	  // This may end up being a tuneable thing, or we may want to calculate it
	  // more intelligently.
	  var bufferWaitTime=fpsInterval*4;

	  // Update to the next frame because current is already loaded.
	  // (This is kind of like a do-while loop)
	  currentFrame=currentFrame+(direction * Math.floor((fpsInterval/videoInterval)));

	  var lastTime=performance.now();
	  var player=function(domtime){

	    // Start the FPS monitor once we start playing
	    if (that._diagTimeout == null)
	    {
		    that._diagTimeout = setTimeout(diagRoutine, schedDiagInterval, Date.now());
	    }

	    //Recalculate interval
	    videoInterval=(1000/that._fps)*(1/that._playbackRate);
	    fpsInterval=Math.max(videoInterval, (1000/guiFPS));
	    var tolerance = fpsInterval * 0.05;

	    // Browser animates at 60 fps, if we land within 5% of a
	    // scheduled frame, display it.
	    if (Math.abs((domtime-lastTime)-fpsInterval) < tolerance)
	    {
		    that.displayLatest();
		    lastTime=domtime;
	    }
	    else if ((domtime-lastTime) > fpsInterval)
	    {
		    // If we missed our tolerance goal
		    that.displayLatest();
		    lastTime=domtime;
	    }

	    if (that._draw.canPlay())
	    {
		    that._playerTimeout=window.requestAnimationFrame(player);
	    }
	    else
	    {
		    that._playerTimeout=null;
	    }
	  };

	  /// This is the loader thread it recalculates intervals based on GUI changes
	  /// and seeks to the current frame in the off-screen buffer. If the player
	  /// isn't running and there are sufficient frames it will kick off the player
	  /// in 10 load cycles
	  var loader=function(){

	    // If the load buffer is full try again in the load interval
	    if (that._draw.canLoad() == false)
	    {
		    // This represents half the buffer
		    that._loaderTimeout=setTimeout(loader, fpsInterval*30);
		    return;
	    }

	    //Recalculate interval
	    videoInterval=(1000/that._fps)*(1/that._playbackRate);
	    fpsInterval=Math.max(videoInterval, (1000/guiFPS));

	    // Canidate next frame
	    var nextFrame=currentFrame+(direction * Math.round((fpsInterval/videoInterval)));

	    //Schedule the next load if we are done loading
	    var pushAndGoToNextFrame=function(frameIdx, source, width, height)
	    {
		    that._fpsLoadDiag++;
		    that.pushFrame(frameIdx, source, width, height);

		    // If the next frame is loadable and we didn't get paused set a timer, else exit
		    if (nextFrame >= 0 && nextFrame < that._numFrames && that._direction!=Direction.STOPPED)
		    {
		      // Update the next frame to display and recurse back at twice the framerate
		      currentFrame=nextFrame;
		      that._loaderTimeout=setTimeout(loader, fpsInterval/4);
		    }
		    else
		    {
		      that._loaderTimeout=null;
          that._direction=Direction.STOPPED;
		    }
	    }


	    // Seek to the current frame and call our atomic callback
	    that.seekFrame(currentFrame, pushAndGoToNextFrame);


	    // If the player is dead, we should restart it
	    if (that._playerTimeout == null && that._draw.canPlay())
	    {
		    that._playerTimeout=setTimeout(player, bufferWaitTime);
	    }
	  };

	  // turn on/off diagnostics
	  if (true)
	  {
	    this._fpsDiag=0;
	    this._fpsLoadDiag=0;
      this._fpsScore=3;

	    var diagRoutine=function(last)
	    {
        var diagInterval = Date.now()-last;
        var calculatedFPS = (that._fpsDiag / diagInterval)*1000.0;
        var loadFPS = ((that._fpsLoadDiag / diagInterval)*1000.0);
        var targetFPS = Math.min(that._fps * that._playbackRate, guiFPS);
		    console.info(`FPS = ${calculatedFPS}, Load FPS = ${loadFPS}, Score=${that._fpsScore}, targetFPS=${targetFPS}`);
		    that._fpsDiag=0;
		    that._fpsLoadDiag=0;

        if (that._fpsScore)
        {
          var healthyFPS = targetFPS * 0.90;
          if (calculatedFPS < healthyFPS)
          {
            that._fpsScore--;
          }
          else
          {
            that._fpsScore = Math.min(that._fpsScore + 1,3);
          }

          if (that._fpsScore == 0)
          {
            console.warn("Detected slow performance, entering safe mode.");
            that.dispatchEvent(new Event("safeMode"));
          }
        }

		    if (that._direction!=Direction.STOPPED)
		    {
		      that._diagTimeout = setTimeout(diagRoutine, schedDiagInterval, Date.now());
		    }

	    };
	  }

	  // Kick off the loader
	  this._loaderTimeout=setTimeout(loader, 0);
  }

  addPlayListener(cb)
  {
	  this._playCb.push(cb);
  }

  addPauseListener(cb)
  {
	  this._pauseCb.push(cb);
  }

  play()
  {
	  this.pause();
	  this._playCb.forEach(cb => {cb();});
	  this._playGeneric(Direction.FORWARD);
  }

  playBackwards()
  {
	  this.pause();
	  this._playCb.forEach(cb => {cb();});
	  this._playGeneric(Direction.BACKWARDS);
  }

  pause()
  {
	  // If we weren't already paused send the event
	  if (this._direction != Direction.STOPPED)
	  {
	    this._pauseCb.forEach(cb => {cb();});
	  }

	  this._direction=Direction.STOPPED;
	  this._videoElement.pause();
	  if (this._playerTimeout)
	  {
	    clearTimeout(this._playerTimeout);
	    this._playerTimeout=null;
	  }
	  if (this._loaderTimeout)
	  {
	    clearTimeout(this._loaderTimeout);
	    this._loaderTimeout=null;
	  }

	  if (this._diagTimeout)
	  {
	    clearTimeout(this._diagTimeout);
	    this._diagTimeout=null;
	  }

	  this.seekFrame(this._dispFrame, this.drawFrame);
  }

  back()
  {
	  var newFrame=this._dispFrame-1;
	  if (newFrame >= 0)
	  {
	    this.seekFrame(newFrame, this.drawFrame);
	  }
  }

  advance()
  {
	  var newFrame=this._dispFrame+1;
	  if (newFrame < this._numFrames)
	  {
	    this.seekFrame(newFrame, this.drawFrame);
	  }
  }

  //////////////////////////////////
  /// End button handlers
  //////////////////////////////////
};

customElements.define("video-canvas", VideoCanvas);
