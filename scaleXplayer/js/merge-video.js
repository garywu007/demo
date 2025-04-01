const BUFFER_MARGIN = 10;
const PAUSE_THRESHOLD = 360; // Pause if buffer exceeds 2 minutes ahead
const RESUME_THRESHOLD = 300; // Resume when within 110 seconds of paused point

const VideoPlayer = document.getElementById("Vplayer");
var VideoPlayerSrc = document.getElementById("VplayerSrc");

let isPausedDueToBuffer = { video: false, audio: false };
let pausedPoint = { video: 0, audio: 0 };

let controller = new AbortController();

// document.getElementById('submitBtn').addEventListener('click', async () => 
async function getHDVideoUrl(youtubeUrl) {
  if (!youtubeUrl) {
    alert('Please enter a valid YouTube URL');
    return;
  }

  try {
    // Send POST request to the backend to get video and audio URLs
    console.log("5");
    controller.abort();
    const response = await fetch('https://centos7:9200/tube-hd-data/' + encodeURIComponent(youtubeUrl));

    if (!response.ok) {
      throw new Error(`Failed to fetch video/audio URLs: ${response.statusText}`);
    }

    const data = await response.json(); // Example response: { videoUrl, audioUrl }
    console.log('Received data:', data);

    if (data.videoUrl && data.audioUrl) {
      streamCombinedVideo(data.videoUrl, data.audioUrl, data.videoCodecs);
    } else {
      throw new Error('Invalid video/audio URL format in response');
    }
  } catch (error) {
    console.error('Error fetching video/audio:', error);
    alert('Failed to fetch video/audio. Check console for details.');
  }
};

async function streamCombinedVideo(videoUrl, audioUrl, videoCodecs) {
  const mediaSource = new MediaSource();
  VideoPlayerSrc.src = URL.createObjectURL(mediaSource);
  VideoPlayer.load();
  VideoPlayer.play();
  console.log("6");

  mediaSource.addEventListener('sourceopen', async () => {
    const videoSourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="' + videoCodecs + '"');
    const audioSourceBuffer = mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');

    // Start fetching video and audio in parallel
    streamData(videoUrl, videoSourceBuffer, "video");
    streamData(audioUrl, audioSourceBuffer, "audio");
  });
}

async function streamData(url, sourceBuffer, type) {
  console.log(`Streaming ${type} from URL, controller signal: ${controller.signal}`);
  const response = await fetch(url, {
    signal: controller.signal
  });
  const reader = response.body.getReader();

  async function pushChunk() {
    // ✅ Resume if paused due to buffering
    if (isPausedDueToBuffer[type]) {
      const currentTime = VideoPlayer.currentTime;
      // document.getElementById(`${type}BufferStatus`).textContent = `${type} Paused at ${pausedPoint[type]}, currentTime: ${currentTime}`;
      
      if (pausedPoint[type] - currentTime <= RESUME_THRESHOLD) {
        isPausedDueToBuffer[type] = false;
      } else {
        // Keep checking in short intervals
        requestAnimationFrame(pushChunk);
        return;
      }
    }

    // ✅ Skip if already buffering or paused
    if (isPausedDueToBuffer[type]) return;

    if (!sourceBuffer.updating) {
      try {
        // ✅ Append data if within buffer limit
        if (shouldAppendBuffer(sourceBuffer, type)) {
          const { done, value } = await reader.read();

          if (done) {
            console.log(`[${type}] Finished streaming`);
            return;
          }
          sourceBuffer.appendBuffer(value);
          cleanupBuffer(sourceBuffer, type);
          // document.getElementById(`${type}Buffer`).textContent = `${type} Buffered: ${sourceBuffer.buffered.end(0)}`;
        } else {
          pausedPoint[type] = VideoPlayer.currentTime + PAUSE_THRESHOLD;
          isPausedDueToBuffer[type] = true;

          // Resume when the buffer is consumed
          requestAnimationFrame(pushChunk);
          return;
        }
      } catch (error) {
        console.error(`[${type}] Error appending buffer:`, error);
      }
    }

    // ✅ Continue when buffer update finishes
    sourceBuffer.addEventListener('updateend', pushChunk, { once: true });
  }

  pushChunk(); // Start streaming chunks
}

function shouldAppendBuffer(sourceBuffer, type) {
  let result = true;
  const currentTime = VideoPlayer.currentTime;

  if (sourceBuffer.buffered.length > 0) {
    const bufferedEnd = sourceBuffer.buffered.end(0);

    // ✅ Stop if buffer exceeds 2 minutes ahead
    if (bufferedEnd - currentTime > PAUSE_THRESHOLD) {
      result = false;
    }
  }

  // document.getElementById(`${type}ShouldAppendBuffer`).textContent = `${type} Should Append: ${result}, currentTime: ${currentTime}`;
  return result;
}

function cleanupBuffer(sourceBuffer, type) {
  if (sourceBuffer.buffered.length > 0) {
    const currentTime = VideoPlayer.currentTime;
    const bufferedStart = sourceBuffer.buffered.start(0);

    // ✅ Remove buffer data more than 3 seconds behind the playhead
    if (currentTime - bufferedStart > BUFFER_MARGIN) {
      try {
        // console.log(`[${type}] Removing buffer from ${bufferedStart} to ${currentTime - BUFFER_MARGIN}`);
        sourceBuffer.remove(bufferedStart, currentTime - BUFFER_MARGIN);
      } catch (error) {
        console.error(`[${type}] Error removing buffer:`, error);
      }
    }
  }
}