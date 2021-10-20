import { TXMPlatform } from 'truex-shared/focus_manager/txm_platform';

import './video-controller.scss';
import playSvg from '../assets/play-button.svg';
import pauseSvg from '../assets/pause-button.svg';

import { AdBreak } from "./ad-break";
import { InteractiveAd } from "./interactive-ad";

const adSlotW = 1280;
const adSlotH = 720;

export class VideoController {
    constructor(videoOwner, controlBarSelector, platform) {
        this.debug = false; // set to true to enable more verbose video time logging.

        this.videoOwner = document.querySelector(videoOwner);
        if (!this.videoOwner) {
            throw new Error('video owner not found: ' + videoOwner);
        }
        this.video = null;
        this.videoStream = null;

        this.adsManager = null;
        this.adDisplayContainer = null;
        this.adsLoader = null;
        this.currentAd = null;

        this.controlBarDiv = document.querySelector(controlBarSelector);
        this.isControlBarVisible = false;
        this.showControlBarInitially = false;

        this.adIndicator = document.querySelector('.ad-indicator');

        this.playButton = this.controlBarDiv.querySelector('.play-button');
        this.playButton.innerHTML = playSvg;

        this.pauseButton = this.controlBarDiv.querySelector('.pause-button');
        this.pauseButton.innerHTML = pauseSvg;

        this.progressBar = this.controlBarDiv.querySelector('.timeline-progress');
        this.seekBar = this.controlBarDiv.querySelector('.timeline-seek');
        this.adMarkersDiv = this.controlBarDiv.querySelector('.ad-markers');

        this.timeLabel = this.controlBarDiv.querySelector('.current-time');
        this.durationLabel = this.controlBarDiv.querySelector('.duration');

        this.videoStarted = false;
        this.initialVideoTime = 0;
        this.currVideoTime = -1;
        this.seekTarget = undefined;
        this.adBreaks = [];

        this.platform = platform || new TXMPlatform();

        this.loadingSpinner = null;
        this.playPromise = null;

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
            this.adBreaks = []; // ensure ad breaks get reloaded
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
        this.video = video;
        this.video.src = videoStream.url;

        // Put the video underneath any control overlays.
        const overlay = this.videoOwner.firstChild;
        this.videoOwner.insertBefore(this.video, overlay);

        if (this.platform.isAndroidTV) {
            video.poster = 'noposter'; // work around grey play icon on Android TV.
        }

        video.addEventListener('playing', this.onVideoStarted);
        video.addEventListener("timeupdate", this.onVideoTimeUpdate);

        // We are showing our own Ad UI, so just pass in a disconnected place holder to keep the manager happy.
        const adUI = document.createElement('div');

        this.adDisplayContainer = new google.ima.AdDisplayContainer(adUI, video);
        this.adsLoader = new google.ima.AdsLoader(this.adDisplayContainer);

        // Listen and respond to ads loaded and error events.
        this.adsLoader.addEventListener(
            google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, this.onAdsManagerLoaded, false);
        this.adsLoader.addEventListener(
            google.ima.AdErrorEvent.Type.AD_ERROR, this.onAdError, false);

        // An event listener to tell the SDK that our content video
        // is completed so the SDK can play any post-roll ads.
        this.video.onended = () => this.adsLoader.contentComplete();

        if (isFirstStart) {
            // Request video ads.
            var adsRequest = new google.ima.AdsRequest();

            // Normal scenario is to request a VAST VMAP ad playlist via a url.
            // For this demo application, we will use a canned xml response.
            // adsRequest.adTagUrl = 'https://pubads.g.doubleclick.net/gampad/ads?' +
            //     'sz=640x480&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&' +
            //     'impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&' +
            //     'cust_params=deployment%3Ddevsite%26sample_ct%3Dlinear&correlator=';
            adsRequest.adResponse = require('../data/sample-ad-playlist.xml');

            // Specify the linear and nonlinear slot sizes. This helps the SDK to
            // select the correct creative if multiple are returned.
            adsRequest.linearAdSlotWidth = adSlotW;
            adsRequest.linearAdSlotHeight = adSlotH;
            adsRequest.nonLinearAdSlotWidth = adSlotW;
            adsRequest.nonLinearAdSlotHeight = adSlotH;

            this.adsLoader.requestAds(adsRequest);
        } else {
            this.playVideo();
        }
    }

    stopOldVideo(newVideoStream) {
        if (this.video) {
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

        const video = this.video;
        if (!video) return;

        this.pause();

        video.removeEventListener('timeupdate', this.onVideoTimeUpdate);
        video.removeEventListener('playing', this.onVideoStarted);

        video.src = ''; // ensure actual video is unloaded (needed for PS4).

        this.videoOwner.removeChild(video); // remove from the DOM

        this.adsManager.reset();

        this.video = null;
        this.adsManager = null;
        this.seekTarget = undefined;
    }

    onAdsManagerLoaded(event) {
        const settings = new google.ima.AdsRenderingSettings();
        settings.restoreCustomPlaybackStateOnAdBreakComplete = true;

        this.adsManager = event.getAdsManager(this.video, settings);

        // Add listeners to the required events.
        this.adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, this.onAdError);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, onContentPauseRequested);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED,
            onContentResumeRequested);
        this.adsManager.addEventListener(
            google.ima.AdEvent.Type.ALL_ADS_COMPLETED, onAdEvent);

        // Listen to any additional events, if necessary.
        this.adsManager.addEventListener(google.ima.AdEvent.Type.LOADED, onAdEvent);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, onAdEvent);
        this.adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, onAdEvent);

        this.refreshAdMarkers = true;
        const childNodes = this.adMarkersDiv.children;
        for (let i = childNodes.length - 1; i >= 0; i--) {
            this.adMarkersDiv.removeChild(childNodes[i]);
        }

        const cuePoints = this.adsManager.getCuePoints();
        this.adBreaks = cuePoints.map((adBreakStart, index) => new AdBreak(adBreakStart, index));
        console.log("ad breaks: " + this.adBreaks.map(adBreak => timeLabel(adBreak.startTime)).join(", "));

        this.refresh();
    }

    onAdEvent(event) {
        // Retrieve the ad from the event. Some events (e.g. ALL_ADS_COMPLETED)
        // don't have ad object associated.
        var ad = event.getAd();
        switch (event.type) {
            case google.ima.AdEvent.Type.LOADED:
                this.startAd(ad);
                break;

            case google.ima.AdEvent.Type.STARTED:
                // This event indicates the ad has started - the video player
                // can adjust the UI, for example display a pause button and
                // remaining time.
                if (ad.isLinear()) {
                    // For a linear ad, a timer can be started to poll for
                    // the remaining time.
                    intervalTimer = setInterval(
                        function() {
                            var remainingTime = this.adsManager.getRemainingTime();
                        },
                        300);  // every 300ms
                }
                break;
            case google.ima.AdEvent.Type.COMPLETE:
                // This event indicates the ad has finished - the video player
                // can perform appropriate UI actions, such as removing the timer for
                // remaining time detection.
                if (ad.isLinear()) {
                    clearInterval(intervalTimer);
                }
                break;
        }
    }

    onAdError(event) {
        console.log(event.getError());
        if (this.adsManager) {
            this.adsManager.destroy();
        }
    }

    onContentPauseRequested() {
        this.video.pause();
        // This function is where you should setup UI for showing ads (e.g.
        // display ad timer countdown, disable seeking etc.)
        // setupUIForAds();
    }

    onContentResumeRequested() {
        this.video.play();
        // This function is where you should ensure that your UI is ready
        // to play content. It is the responsibility of the Publisher to
        // implement this function when necessary.
        // setupUIForContent();
    }

    /**
     * Responds to a Google IMA ad event.
     * @param  {StreamEvent} e
     */
    onStreamEvent(e) {
        const streamData = e.getStreamData();
        const ad = e.getAd();
        console.log('IMA stream event: ' + e.type);
        switch (e.type) {
            case StreamEvent.Type.CUEPOINTS_CHANGED:
                if (this.adBreaks.length == 0) {
                    this.adsManager.removeEventListener(StreamEvent.Type.CUEPOINTS_CHANGED, this.onAdEvent);
                    this.setAdBreaks(streamData.cuepoints);
                }
                break;

            case StreamEvent.Type.LOADED:
                // this.hlsController.loadSource(streamData.url);
                // this.hlsController.on(Hls.Events.MANIFEST_PARSED, () => this.playVideo());
                break;

            case StreamEvent.Type.ERROR:
                break;

            case StreamEvent.Type.STARTED:
                this.startAd(ad);
                break;

            case StreamEvent.Type.AD_BREAK_STARTED:
                // We don't strictly need to know these events since we monitor video time updates anyway.
                // this.hideControlBar();
                // this.adUI.style.display = 'block';
                // this.refresh();
                break;
            case StreamEvent.Type.AD_BREAK_ENDED:
                // this.adUI.style.display = 'none';
                // this.refresh();
                break;

            case StreamEvent.Type.AD_PROGRESS:
                // We are tracking progress via our own video time updates.
                // const adProgress = streamData.adProgressData;
                // const timeRemaining = Math.ceil(adProgress.duration - adProgress.currentTime);
                // console.log('Ad Progress: dur: ' + adProgress.duration + ' remaining: ' + timeRemaining);
                // this.refresh();
                break;
            default:
                break;
        }
    }

    playVideo() {
        if (!this.video) return;
        if (!this.adDisplayContainer) return;
        if (!this.adsManager) return;
        console.log('video played at: ' + this.timeDebugDisplay(this.initialVideoTime));
        this.videoStarted = false; // set to true on the first playing event
        this.currVideoTime = this.initialVideoTime; // will be updated as video progresses

        // Initialize the container. Must be done via a user action on mobile devices.
        this.video.load();
        this.adDisplayContainer.initialize();

        try {
            // Initialize the ads manager. Ad rules playlist will start at this time.
            this.adsManager.init(adSlotW, adSlotH, google.ima.ViewMode.NORMAL);

            // Call play to start showing the ad. Single video and overlay ads will
            // start at this time; the call will be ignored for ad rules.
            this.adsManager.start();

        } catch (adError) {
            // An error may be thrown if there was a problem with the VAST response.
            this.video.play();
        }
    }

    stopControlBarTimer() {
        if (this.controlBarTimer) {
            clearTimeout(this.controlBarTimer);
            this.controlBarTimer = undefined;
        }
    }

    togglePlayPause() {
        if (!this.video) {
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
        if (this.playPromise) return false; // consider the video has not paused if playback is pending
        return !this.video || this.video.paused;
    }

    play() {
        if (!this.video) return;
        if (this.playPromise) return; // don't interrupt current play invocations
        if (this.debug) console.log(`play from: ${this.timeDebugDisplay(this.currVideoTime)}`);
        // Work around PS4 hangs by starting playback in a separate thread.
        setTimeout(() => {
            if (!this.video) return; // video has been closed
            this.playPromise = this.video.play();
            if (this.playPromise) {
                this.playPromise.then(() => {
                    this.playPromise = null;
                });
            }
        }, 10);
    }

    pause() {
        if (!this.video) return;
        if (this.playPromise) return; // don't interrupt current play invocations
        if (this.debug) console.log(`paused at: ${this.timeDebugDisplay(this.currVideoTime)}`);
        this.video.pause();
    }

    stepForward() {
        this.stepVideo(true);
    }

    stepBackward() {
        this.stepVideo(false);
    }

    stepVideo(forward) {
        if (!this.video) return; // user stepping should only happen on an active video
        if (this.currentAd) return; // cannot step thru ads.

        const currTime = this.currVideoTime;

        if (this.hasAdBreakAt(currTime)) {
            // Don't allow user seeking during ad playback
            // Just show the control bar so the user can see the timeline.
            this.showControlBar();
            return;
        }

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

        // Skip over completed ads, but stop on uncompleted ones to force ad playback.
        if (currTime < newTarget) {
            // Seeking forward
            for (var i in this.adBreaks) {
                const adBreak = this.adBreaks[i];
                if (newTarget < adBreak.startTime) break; // ignore future ads after the seek target
                if (adBreak.endTime <= currTime) continue; // ignore past ads

                if (adBreak.completed) {
                    // Skip over the completed ad.
                    newTarget += adBreak.duration;
                } else {
                    // Play the ad instead of stepping over it.
                    newTarget = adBreak.startTime;
                    break;
                }
            }
        } else {
            // Seeking backwards
            for (var i = this.adBreaks.length - 1; i >= 0; i--) {
                const adBreak = this.adBreaks[i];
                if (currTime <= adBreak.startTime) continue; // ignore unplayed future ads
                if (adBreak.endTime < newTarget) break; // ignore ads before the seek target

                if (adBreak.completed) {
                    // Skip over the completed ad.
                    newTarget -= adBreak.duration;
                } else {
                    // Play the ad instead of stepping over it.
                    newTarget = adBreak.startTime;
                    break;
                }
            }
        }

        this.seekTo(newTarget);
    }

    seekTo(newTarget, showControlBar) {
        if (this.playPromise) return; // don't interrupt current play invocations
        if (showControlBar === undefined) showControlBar = true; // default to showing the control bar

        const currTime = this.currVideoTime;
        if (currTime == newTarget) return; // already at the target

        const video = this.video;

        // We only have a max target if the video duration is known.
        const duration = video && video.duration;
        const maxTarget = duration > 0 ? duration : newTarget;

        // Don't allow seeking back to the preroll.
        const firstAdBlock = this.adBreaks[0];
        const minTarget = firstAdBlock && firstAdBlock.startTime <= 0 ? firstAdBlock.duration : 0;

        this.seekTarget = Math.max(minTarget, Math.min(newTarget, maxTarget));

        console.log(`seek to: ${this.timeDebugDisplay(this.seekTarget)}`);

        if (video) {
            video.currentTime = this.seekTarget;

        } else {
            // No video present yet, just record the desired current time for when it resumes.
            this.initialVideoTime = newTarget;
        }

        if (showControlBar) {
            this.showControlBar();
        }
    }

    skipAd(adBreak) {
        if (!adBreak) {
            adBreak = this.getAdBreakAt(this.currVideoTime);
        }
        if (adBreak) {
            adBreak.completed = true;

            console.log(`ad break ${adBreak.index} skipped at: ${this.timeDebugDisplay(adBreak.startTime)}`);

            this.hideControlBar();

            this.adsManager.discardAdBreak();
            this.adsManager.resume();

            // skip a little past the end to avoid a flash of the final ad frame
            // this.seekTo(adBreak.endTime + 1, this.isControlBarVisible);
        }
    }

    startAd(googleAd) {
        this.currentAd = googleAd;
        const podInfo = googleAd.getAdPodInfo();
        const adBreak = this.adBreaks[podInfo.getPodIndex()];
        if (!adBreak) return;
        if (adBreak.started) return; // ad already processed
        if (adBreak.completed) {
            // Ignore ads already completed.
            this.skipAd(adBreak);
            return;
        }

        adBreak.duration = this.adsManager.getRemainingTime();

        // For true[X] IMA integration, the first ad in an ad break points to the interactive ad,
        // everything else are the fallback ad videos, or else non-truex ad videos.
        // So anything not an interactive ad we just let play.
        const isInteractiveAd = googleAd.getAdSystem() == 'trueX' && podInfo.getAdPosition() == 1;
        if (!isInteractiveAd) return;

        var vastConfigUrl = googleAd.getDescription();
        vastConfigUrl = vastConfigUrl && vastConfigUrl.trim();
        if (!vastConfigUrl) return;
        if (!vastConfigUrl.startsWith('http')) {
            vastConfigUrl = 'https://' + vastConfigUrl;
        }
        adBreak.started = true;
        console.log(`truex ad started at ${this.timeDebugDisplay(adBreak.startTime)}:\n${vastConfigUrl}`);

        // Start an interactive ad.
        this.hideControlBar();

        this.adsManager.pause();

        //this.initialVideoTime = adBreak.startTime;

        const ad = new InteractiveAd(vastConfigUrl, adBreak, this);
        setTimeout(() => ad.start(), 1); // show the ad "later" to work around hangs/crashes on the PS4

        return true; // ad started
    }

    onVideoStarted() {
        if (!this.video) return;
        if (this.videoStarted) return;
        this.videoStarted = true;

        console.log('video playback started: ' + this.timeDebugDisplay(this.initialVideoTime));

        if (!this.platform.supportsInitialVideoSeek && this.initialVideoTime > 0) {
            // The initial seek is not supported, e.g. on the PS4. Do it now.
            this.currVideoTime = 0;
            this.seekTo(this.initialVideoTime);
        } else {
            this.showLoadingSpinner(false);
            if (this.showControlBarInitially) {
                const forceTimer = true;
                this.showControlBar(forceTimer);
            } else {
                this.hideControlBar();
            }
        }
    }

    onVideoTimeUpdate() {
        if (!this.video) return;
        if (!this.videoStarted) return;

        const newTime = this.video.currentTime;
        if (this.debug) console.log('video time: ' + this.timeDebugDisplay(newTime));

        const currTime = this.currVideoTime;
        if (newTime == currTime) return;
        this.currVideoTime = newTime;
        this.seekTarget = undefined;

        this.showLoadingSpinner(false);

        const adBreak = this.getAdBreakAt(newTime);
        if (adBreak) {
            if (adBreak.completed) {
                if (Math.abs(adBreak.startTime - newTime) <= 1) {
                    // Skip over already completed ads if we run into their start times.
                    this.skipAd(adBreak);
                    return;
                }
            } else if (!adBreak.started) {
                // We will get Google IMA ad start events when the ad is encountered

            // } else if (Math.abs(adBreak.endTime - newTime) <= 1) {
            //     // The user has viewed the whole ad.
            //     adBreak.completed = true;
            }
        }

        this.refresh();
    }

    hasAdBreakAt(rawVideoTime) {
        const adBreak = this.getAdBreakAt(rawVideoTime);
        return !!adBreak;
    }

    getAdBreakAt(videoTime) {
        if (videoTime === undefined) videoTime = this.currVideoTime;
        for (var index in this.adBreaks) {
            const adBreak = this.adBreaks[index];
            if (Math.abs(adBreak.startTime - videoTime) < 0.1) {
                return adBreak;
            }
        }
        return undefined;
    }

    getVideoDuration() {
        const duration = this.video && this.video.duration || 0;
        return duration;
    }

    timeDebugDisplay(videoTime) {
        var result = timeLabel(videoTime);
        const adBreak = this.getAdBreakAt(videoTime);
        if (adBreak) {
            result += ' (adBreak ' + adBreak.index + ')';
        }
        return result;
    }

    refresh() {
        if (this.currentAd) {
            this.adIndicator.classList.add('show');
        } else {
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

        const durationToDisplay = this.currentAd ? this.currentAd.getDuration() : this.getVideoDuration();
        const currTime = this.currentAd ? durationToDisplay - this.adsManager.getRemainingTime()
            : this.currVideoTime;

        function percentage(time) {
            const result = durationToDisplay > 0 ? (time / durationToDisplay) * 100 : 0;
            return `${result}%`;
        }

        const seekTarget = this.seekTarget;
        let currTimeToDisplay = currTime;
        let timeToDisplay = currTimeToDisplay;
        if (seekTarget >= 0 && !this.currentAd) {
            timeToDisplay = seekTarget;
            const seekTargetDiff = Math.abs(currTimeToDisplay - timeToDisplay);
            this.seekBar.style.width = percentage(seekTargetDiff);
            if (currTimeToDisplay <= timeToDisplay) {
                this.seekBar.style.left = percentage(currTimeToDisplay);
            } else {
                this.seekBar.style.left = percentage(currTimeToDisplay - seekTargetDiff);
            }
            this.seekBar.classList.add('show');

        } else {
            this.seekBar.classList.remove('show');
        }

        this.progressBar.style.width = percentage(timeToDisplay);
        this.durationLabel.innerText = timeLabel(durationToDisplay);

        this.timeLabel.innerText = timeLabel(timeToDisplay);
        this.timeLabel.style.left = percentage(timeToDisplay);

        if (this.currentAd) {
            this.adMarkersDiv.classList.remove('show');
        } else {
            if (this.refreshAdMarkers && durationToDisplay > 0) {
                this.refreshAdMarkers = false;
                this.adBreaks.forEach(adBreak => {
                    const marker = document.createElement('div');
                    marker.classList.add('ad-break');
                    marker.style.left = percentage(adBreak.startTime);
                    this.adMarkersDiv.appendChild(marker);
                });
            }
            this.adMarkersDiv.classList.add('show');
        }
    }
}

function timeLabel(time) {
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
