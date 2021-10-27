import { TXMPlatform } from 'truex-shared/focus_manager/txm_platform';

import '../components/video-controller.scss';
import playSvg from '../assets/play-button.svg';
import pauseSvg from '../assets/pause-button.svg';

import { InteractiveAd } from "../components/interactive-ad";

import videojs from 'video.js';
import 'videojs-contrib-ads';
import 'videojs-ima';

import vastAdPlaylist from '../data/sample-ad-playlist.xml';
import googleVastSample from '../data/google-vast-sample.xml';

/**
 * Presents a video controller that demonstrates the client-side ad insertion IMA SDK
 * in conjunction with the VideoJS video player and plugins, which manages the video player
 * / ad player switching out of the box.
 */
export class VideoJSController {
    constructor(videoOwner, controlBarSelector, platform) {
        this.debug = false; // set to true to enable more verbose video time logging.

        this.videoOwner = document.querySelector(videoOwner);
        if (!this.videoOwner) {
            throw new Error('video owner not found: ' + videoOwner);
        }
        this.player = null;
        this.videoStream = null;
        this.adBreakTimes = null;

        this.adsManager = null;
        this.currentAdProgress = null;
        this.currentAdPaused = false;

        this.controlBarDiv = document.querySelector(controlBarSelector);
        this.isControlBarVisible = false;
        this.showControlBarInitially = false;

        this.playButton = this.controlBarDiv.querySelector('.play-button');
        this.playButton.innerHTML = playSvg;

        this.pauseButton = this.controlBarDiv.querySelector('.pause-button');
        this.pauseButton.innerHTML = pauseSvg;

        this.timeline = this.controlBarDiv.querySelector('.timeline');
        this.progressBar = this.controlBarDiv.querySelector('.timeline-progress');
        this.seekBar = this.controlBarDiv.querySelector('.timeline-seek');
        this.adMarkersDiv = this.controlBarDiv.querySelector('.ad-markers');

        this.timeLabel = this.controlBarDiv.querySelector('.current-time');
        this.durationLabel = this.controlBarDiv.querySelector('.duration');

        this.videoStarted = false;
        this.initialVideoTime = 0;
        this.currVideoTime = -1;
        this.seekTarget = undefined;

        this.platform = platform || new TXMPlatform();

        this.loadingSpinner = null;
        this.playPromise = null;

        // The IMA SDK captures mouse clicks and keyboard focus. We intercept mouse events when ads are not playing
        // to ensure we still have full control.
        this.onMouseEvent = this.onMouseEvent.bind(this);
        this.mouseCapture = this.videoOwner.querySelector('.player-mouse-capture');
        this.mouseCapture.addEventListener("click", this.onMouseEvent);
        this.mouseCapture.addEventListener("mousedown", this.onMouseEvent);
        this.mouseCapture.addEventListener("mouseup", this.onMouseEvent);
        this.mouseCapture.addEventListener("mouseenter", this.onMouseEvent);
        this.mouseCapture.addEventListener("mouseexit", this.onMouseEvent);

        this.onControlBarClick = this.onControlBarClick.bind(this);
        this.controlBarDiv.addEventListener('click', this.onControlBarClick);

        this.onVideoTimeUpdate = this.onVideoTimeUpdate.bind(this);
        this.onVideoStarted = this.onVideoStarted.bind(this);
        this.onAdsManagerLoaded = this.onAdsManagerLoaded.bind(this);
        this.onAdEvent = this.onAdEvent.bind(this);
        this.onAdError = this.onAdError.bind(this);
        this.onContentPauseRequested = this.onContentPauseRequested.bind(this);
        this.onContentResumeRequested = this.onContentResumeRequested.bind(this);

        this.closeVideoAction = function() {}; // override as needed
    }

    showControlBar(forceTimer) {
        this.controlBarDiv.classList.add('show');
        this.isControlBarVisible = true;
        this.refresh();

        this.stopControlBarTimer();
        if (forceTimer || !this.isPaused()) {
            this.controlBarTimer = setTimeout(() => this.hideControlBar(), 8 * 1000);
        }
    }

    hideControlBar() {
        this.controlBarDiv.classList.remove('show');
        this.isControlBarVisible = false;
        this.stopControlBarTimer();
    }

    showLoadingSpinner(visible) {
        const spinner = this.loadingSpinner;
        if (!spinner) return;
        if (visible) spinner.show();
        else spinner.hide();
    }

    showPlayer(visible) {
        if (visible) {
            this.videoOwner.classList.add('show');
        } else {
            this.videoOwner.classList.remove('show');
        }
    }

    // Create the video element "later" to work around some hangs and crashes, e.g. on the PS4
    startVideoLater(videoStream, showControlBar) {
        this.stopOldVideo(videoStream);
        setTimeout(() => this.startVideo(videoStream, showControlBar), 1);
    }

    startVideo(videoStream, showControlBar) {
        this.stopOldVideo(videoStream);

        this.showControlBarInitially = showControlBar || false;

        const isFirstStart = !!videoStream;
        if (videoStream) {
            this.videoStream = videoStream;
            this.initialVideoTime = 0; // ensure we start at the beginning
            console.log(`starting video: ${videoStream.title}`);
        } else {
            videoStream = this.videoStream;
            if (!videoStream) {
                throw new Error('missing video stream');
            }
        }

        this.showLoadingSpinner(true);

        const video = document.createElement('video');

        // Put the video underneath any control overlays.
        const firstOverlayChild = this.videoOwner.firstChild;
        this.videoOwner.insertBefore(video, firstOverlayChild);

        this.refreshAdMarkers = true;
        const childNodes = this.adMarkersDiv.children;
        for (let i = childNodes.length - 1; i >= 0; i--) {
            this.adMarkersDiv.removeChild(childNodes[i]);
        }

        this.player = videojs(video, {controls: false});
        this.player.src({src: videoStream.url, type: 'video/mp4'});
        this.player.on('playing', this.onVideoStarted);
        this.player.on('timeupdate', this.onVideoTimeUpdate);

        // Normal scenario is to request a VAST VMAP ad playlist via a url.
        // For this demo application, we will use a canned xml response.
        const imaOptions = {
            // adTagUrl: 'https://pubads.g.doubleclick.net/gampad/ads?' +
            //     'sz=640x480&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&' +
            //     'impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&' +
            //     'cust_params=deployment%3Ddevsite%26sample_ct%3Dlinear&correlator=',
            // adsResponse: googleVastSample,
            adsResponse: vastAdPlaylist
        };
        this.player.ima(imaOptions);

        this.player.on('ads-manager', response => {
            this.adsManager = response.adsManager;

            // Add listeners to the required events.
            this.adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, this.onAdError);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, this.onContentPauseRequested);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, this.onContentResumeRequested);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, this.onAdEvent);

            // Listen to any additional events, if necessary.
            this.adsManager.addEventListener(google.ima.AdEvent.Type.LOADED, this.onAdEvent);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, this.onAdEvent);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.AD_PROGRESS, this.onAdEvent);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.PAUSED, this.onAdEvent);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.RESUMED, this.onAdEvent);
            this.adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, this.onAdEvent);

            this.playVideo();
            this.refresh();
        });

        this.player.ima.initializeAdDisplayContainer();
    }

    stopOldVideo(newVideoStream) {
        if (this.player) {
            if (newVideoStream && this.videoStream === newVideoStream) {
                return; // already playing.
            } else {
                // Stop the existing video. (Creating a new video instance is more reliable across
                // platforms than just changing the video.src)
                this.stopVideo();
            }
        }
    }

    stopVideo() {
        this.hideControlBar();

        this.showLoadingSpinner(false);

        if (!this.player) return;
        this.player.dispose();
        this.player = null;

        // TODO: needed?
        // if (this.video.parentNode) {
        //     this.video.videoOwner.removeChild(video); // remove from the DOM
        // }

        this.adBreakTimes = null;
        this.seekTarget = undefined;

        if (this.adsManager) {
            this.adsManager.destroy();
            this.adsManager = null;
        }
    }

    onAdsManagerLoaded(response) {
        this.adsManager = response.adsManager;

        // Add listeners to the required events.
        this.adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, this.onAdError);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, this.onContentPauseRequested);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, this.onContentResumeRequested);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, this.onAdEvent);

        // Listen to any additional events, if necessary.
        this.adsManager.addEventListener(google.ima.AdEvent.Type.LOADED, this.onAdEvent);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, this.onAdEvent);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.AD_PROGRESS, this.onAdEvent);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.PAUSED, this.onAdEvent);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.RESUMED, this.onAdEvent);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, this.onAdEvent);

        this.playVideo();

        this.refresh();
    }

    onAdEvent(event) {
        // Retrieve the ad from the event. Some events (e.g. ALL_ADS_COMPLETED)
        // don't have ad object associated.
        const ad = event.getAd();
        switch (event.type) {
            case google.ima.AdEvent.Type.LOADED:
                if (!this.adBreakTimes) {
                    this.adBreakTimes = this.adsManager.getCuePoints();
                    if (this.adBreakTimes) {
                        console.log("ad breaks: " + this.adBreakTimes.map(timeLabelOf).join(', '));
                    }
                }
                break;

            case google.ima.AdEvent.Type.STARTED:
                console.log("ad started: " + ad.getAdId() + ' duration: ' + ad.getDuration()
                    + ' pod: ' + ad.getAdPodInfo().getPodIndex());
                this.currentAdProgress = null;
                this.currentAdPaused = false;
                this.showLoadingSpinner(false);
                this.hideControlBar();
                this.refresh();

                this.startInteractiveAd();
                break;

            case google.ima.AdEvent.Type.AD_PROGRESS:
                this.currentAdProgress = event.getAdData();
                this.refresh();
                break;

            case google.ima.AdEvent.Type.COMPLETE:
                console.log("ad complete: " + ad.getAdId());
            case google.ima.AdEvent.Type.ALL_ADS_COMPLETED:
                this.currentAdProgress = null;
                this.refresh();
                break;
        }
    }

    onAdError(event) {
        const err = event.getError();
        console.error("ad error: " + (err && err.getMessage() || "unknown error"));
        if (this.adsManager) {
            this.adsManager.destroy();
            this.adsManager = null;
            this.playVideo();
        }
    }

    onContentPauseRequested() {
        console.log("video content paused");
        this.player.pause();
        this.refresh();
    }

    onContentResumeRequested() {
        console.log("video content resumed");
        this.player.play();
        this.refresh();

        // The client-side IMA SDK can steal the keyboard focus, esp if the user is clicking on ads.
        // Ensure the app focus is again in place.
        window.focus();
    }

    playVideo() {
        if (!this.player) return;
        if (!this.adsManager) return;
        console.log('video playing at: ' + timeLabelOf(this.initialVideoTime));
        this.videoStarted = false; // set to true on the first playing event
        this.currVideoTime = this.initialVideoTime; // will be updated as video progresses

        // Initialize the container. Must be done via a user action on mobile devices.
        this.player.play();

        try {
            // Initialize the ads manager. Ad rules playlist will start at this time.
            // const adSize = this.getPlayerSize();
            // this.adsManager.init(adSize.width, adSize.height, google.ima.ViewMode.NORMAL);
            //
            // // Call play to start showing the ad. Single video and overlay ads will
            // // start at this time; the call will be ignored for ad rules.
            // this.adsManager.start();

        } catch (adError) {
            // An error may be thrown if there was a problem with the VAST response.
            console.error("ads manager start error: " + adError);
            this.player.play();
        }
    }

    stopControlBarTimer() {
        if (this.controlBarTimer) {
            clearTimeout(this.controlBarTimer);
            this.controlBarTimer = undefined;
        }
    }

    togglePlayPause() {
        if (!this.player) {
            const showControlBar = true;
            this.startVideoLater(null, showControlBar);
            return;
        }

        let forceControlBarTimeout = false;
        if (this.isPaused()) {
            forceControlBarTimeout = true
            this.play();
        } else {
            this.pause();
        }

        this.showControlBar(forceControlBarTimeout);
    }

    isPaused() {
        const ad = this.getCurrentAd();
        if (ad) {
            return this.currentAdPaused;
        }

        if (this.playPromise) return false; // consider the video has not paused if playback is pending
        return !this.player || this.player.paused();
    }

    play() {
        const ad = this.getCurrentAd();
        if (ad) {
            this.currentAdPaused = false;
            console.log("resumed ad playback");
            this.adsManager.resume();
            return;
        }

        if (!this.player) return;
        if (this.playPromise) return; // don't interrupt current play invocations
        if (this.debug) console.log(`play from: ${timeLabelOf(this.currVideoTime)}`);
        // Work around PS4 hangs by starting playback in a separate thread.
        setTimeout(() => {
            if (!this.player) return; // video has been closed
            console.log("playing video");
            this.playPromise = this.player.play();
            if (this.playPromise) {
                this.playPromise
                .then(() => this.playPromise = null)
                .catch(() => this.playPromise = null);
            }
        }, 10);
    }

    pause() {
        if (this.isPaused()) return;

        const ad = this.getCurrentAd();
        if (ad) {
            this.currentAdPaused = true;
            console.log("paused ad playback");
            this.adsManager.pause();
            return;
        }

        if (!this.player) return;
        if (this.playPromise) return; // don't interrupt current play invocations
        if (this.debug) console.log(`paused at: ${timeLabelOf(this.currVideoTime)}`);
        console.log("paused video");
        this.player.pause();
    }

    stepForward() {
        this.stepVideo(true);
    }

    stepBackward() {
        this.stepVideo(false);
    }

    stepVideo(forward) {
        const ad = this.getCurrentAd();
        if (ad) {
            // Don't allow user seeking during ad playback
            // Just show the control bar so the user can see the timeline.
            this.showControlBar();
            return;
        }

        if (!this.player) return; // user stepping should only happen on an active video
        const currTime = this.currVideoTime;

        let seekStep = 10; // default seek step seconds
        const seekChunks = 80; // otherwise, divide up videos in this many chunks for seek steps
        const duration = currTime;
        if (duration > 0) {
            const dynamicStep = Math.floor(duration / seekChunks);
            seekStep = Math.max(seekStep, dynamicStep);
        }
        if (!forward) seekStep *= -1;
        const stepFrom = this.seekTarget >= 0 ? this.seekTarget : currTime;

        let newTarget = stepFrom + seekStep;

        this.seekTo(newTarget);
    }

    seekTo(newTarget, showControlBar) {
        if (this.playPromise) return; // don't interrupt current play invocations
        if (showControlBar === undefined) showControlBar = true; // default to showing the control bar

        const currTime = this.currVideoTime;
        if (currTime == newTarget) return; // already at the target

        const player = this.player;

        // We only have a max target if the video duration is known.
        const duration = player && player.duration();
        const maxTarget = duration > 0 ? duration : newTarget;

        this.seekTarget = Math.max(0, Math.min(newTarget, maxTarget));

        console.log(`seek to: ${timeLabelOf(this.seekTarget)}`);

        if (player) {
            player.currentTime(this.seekTarget);

        } else {
            // No video present yet, just record the desired current time for when it resumes.
            this.initialVideoTime = newTarget;
        }

        if (showControlBar) {
            this.showControlBar();
        }
    }

    onMouseEvent(event) {
        const ad = this.getCurrentAd();
        if (ad) {
            // Let the ad handle the click, but ensure the keyboard focus is restored.
            setTimeout(() => window.focus(), 0);
            return;
        }

        if (event.type == "click") {
            // Otherwise, any click on the player is a play/pause toggle.
            this.togglePlayPause();
        }

        event.stopImmediatePropagation();
        event.preventDefault();
    }

    onControlBarClick(event) {
        event.stopImmediatePropagation();
        event.preventDefault();

        const timelineBounds = this.timeline.getBoundingClientRect();
        const mouseX = event.clientX;
        if (mouseX < timelineBounds.left) {
            // Interpret as a play/pause toggle, in case we are clicking just beside the button.
            this.togglePlayPause();

        } else {
            // Interpret as a seek.
            const ad = this.getCurrentAd();
            if (ad) return;  // Don't allow user seeking during ad playback
            const timelineX = Math.max(0, mouseX - timelineBounds.left);
            const timelineRatio = timelineX / timelineBounds.width;
            const videoDuration = this.getVideoDuration();
            this.seekTo(videoDuration * timelineRatio);
        }
    }

    skipAdBreak() {
        const ad = this.getCurrentAd();
        if (ad) {
            console.log(`ad break ${ad.getAdPodInfo().getPodIndex()} skipped`);
            this.adsManager.discardAdBreak();
        }
        this.hideControlBar();
    }

    resumeAdPlayback() {
        if (this.adsManager) {
            if (this.isShowingTruexAd()) {
                this.adsManager.skip();
            }
            console.log("resumed ad playback");
            this.adsManager.resume();
        }
    }

    getPlayerSize() {
        return {
            width: this.videoOwner.clientWidth,
            height: this.videoOwner.clientHeight
        };
    }

    getCurrentAd() {
        return this.adsManager && this.adsManager.getCurrentAd();
    }

    isShowingTruexAd() {
        const ad = this.getCurrentAd();
        return ad && ad.getAdSystem() == 'trueX' && ad.getAdPodInfo().getAdPosition() == 1;
    }

    startInteractiveAd() {
        // For true[X] IMA integration, the first ad in an ad break points to the interactive ad,
        // everything else are the fallback ad videos, or else non-truex ad videos.
        // So anything not an interactive ad we just let play.
        if (!this.isShowingTruexAd()) return;

        const ad = this.getCurrentAd();
        const adPod = ad.getAdPodInfo();

        const adParams = JSON.parse(ad.getTraffickingParametersString());
        var vastConfigUrl = adParams && adParams.vast_config_url;
        vastConfigUrl = vastConfigUrl && vastConfigUrl.trim();
        if (!vastConfigUrl) return;
        if (!vastConfigUrl.startsWith('http')) {
            vastConfigUrl = 'https://' + vastConfigUrl;
        }
        console.log(`truex ad started at ${timeLabelOf(adPod.getTimeOffset())}:\n${vastConfigUrl}`);

        // Start an interactive ad.
        this.hideControlBar();
        this.pause();

        const interactiveAd = new InteractiveAd(vastConfigUrl, this);
        setTimeout(() => interactiveAd.start(), 1); // show the ad "later" to work around hangs/crashes on the PS4

        return true; // ad started
    }

    onVideoStarted() {
        if (!this.player) return;
        if (this.videoStarted) return;
        this.videoStarted = true;

        console.log('video playback started: ' + timeLabelOf(this.initialVideoTime));

        this.showLoadingSpinner(false);
        if (this.showControlBarInitially) {
            const forceTimer = true;
            this.showControlBar(forceTimer);
        } else {
            this.hideControlBar();
        }
    }

    onVideoTimeUpdate() {
        if (!this.player) return;
        if (!this.videoStarted) return;

        const newTime = this.player.currentTime();
        if (this.debug) console.log('video time: ' + timeLabelOf(newTime));

        const currTime = this.currVideoTime;
        if (newTime == currTime) return;
        this.currVideoTime = newTime;
        this.seekTarget = undefined;

        this.showLoadingSpinner(false);

        this.refresh();
    }

    getVideoDuration() {
        const duration = this.player && this.player.duration() || 0;
        return duration;
    }

    refresh() {
        return; // TODO remove this method
        const ad = this.getCurrentAd();
        const adProgress = this.currentAdProgress;
        const durationToDisplay = ad ? ad.getDuration() : this.getVideoDuration();
        const currTime = ad ? (adProgress ? adProgress.currentTime : 0) : this.currVideoTime;

        if (ad) {
            // Playing an ad, show the ad indicator.
            this.adIndicator.classList.add('show');
        } else {
            // Playing main content.
            this.adIndicator.classList.remove('show');
        }

        if (!this.isControlBarVisible) {
            // other updates don't matter unless the control bar is visible
            return;
        }

        if (this.isPaused()) {
            // Next play input action will resume playback
            this.playButton.classList.add('show');
            this.pauseButton.classList.remove('show');
        } else {
            // Next play input action will pause playback
            this.playButton.classList.remove('show');
            this.pauseButton.classList.add('show');
        }

        function percentage(time) {
            const result = durationToDisplay > 0 ? (time / durationToDisplay) * 100 : 0;
            return `${result}%`;
        }

        const seekTarget = this.seekTarget;
        let timeToDisplay = currTime;
        if (seekTarget >= 0 && !ad) {
            timeToDisplay = seekTarget;
            const seekTargetDiff = Math.abs(currTime - timeToDisplay);
            this.seekBar.style.width = percentage(seekTargetDiff);
            if (currTime <= timeToDisplay) {
                this.seekBar.style.left = percentage(currTime);
            } else {
                this.seekBar.style.left = percentage(currTime - seekTargetDiff);
            }
            this.seekBar.classList.add('show');

        } else {
            this.seekBar.classList.remove('show');
        }

        this.progressBar.style.width = percentage(timeToDisplay);
        this.durationLabel.innerText = timeLabelOf(durationToDisplay);

        this.timeLabel.innerText = timeLabelOf(timeToDisplay);
        this.timeLabel.style.left = percentage(timeToDisplay);

        if (ad) {
            this.adMarkersDiv.classList.remove('show');
        } else {
            if (durationToDisplay > 0 && this.refreshAdMarkers && this.adBreakTimes) {
                this.refreshAdMarkers = false;
                this.adBreakTimes.forEach(startTime => {
                    const marker = document.createElement('div');
                    marker.classList.add('ad-break');
                    marker.style.left = percentage(startTime);
                    this.adMarkersDiv.appendChild(marker);
                });
            }
            this.adMarkersDiv.classList.add('show');
        }
    }
}

function timeLabelOf(time) {
    time = Math.round(time);
    const seconds = time % 60;
    time /= 60;
    const minutes = time % 60;
    time /= 60;
    const hours = time;

    const result = pad(minutes) + ':' + pad(seconds);
    if (hours >= 1) return Math.floor(hours) + ':' + result;
    return result;
}

function pad(value) {
    value = Math.floor(value || 0);
    return (value < 10) ? '0' + value : value.toString();
}
