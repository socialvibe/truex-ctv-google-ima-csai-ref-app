import { TXMPlatform } from 'truex-shared/focus_manager/txm_platform';

import '../components/video-controller.scss';
import playSvg from '../assets/play-button.svg';
import pauseSvg from '../assets/pause-button.svg';

import { InteractiveAd } from "../components/interactive-ad";

import vastAdPlaylist from '../data/sample-ad-playlist.xml';

/**
 * Presents a video controller that demonstrates the client-side ad insertion IMA SDK
 * in conjunction with the Bitmovin video player with built-in IMA advertising module.
 */
export class BitmovinController {
    constructor(videoOwner, controlBarSelector, platform) {
        this.debug = false;

        this.currentUserId = null;

        this.videoOwner = document.querySelector(videoOwner);
        if (!this.videoOwner) {
            throw new Error('video owner not found: ' + videoOwner);
        }
        this.player = null;
        this.videoStream = null;
        this.adBreakTimes = null;

        this.adsManager = null;
        this.currentAd = null;
        this.currentAdProgress = null;
        this.currentAdPaused = false;

        this.controlBarDiv = document.querySelector(controlBarSelector);
        this.isControlBarVisible = false;
        this.showControlBarInitially = false;

        this.adIndicator = document.querySelector('.ad-indicator');

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

        this.videoOwner.addEventListener("click", () => window.focus());

        this.onControlBarClick = this.onControlBarClick.bind(this);
        this.controlBarDiv.addEventListener('click', this.onControlBarClick);

        this.onVideoTimeUpdate = this.onVideoTimeUpdate.bind(this);
        this.onVideoStarted = this.onVideoStarted.bind(this);
        this.onAdEvent = this.onAdEvent.bind(this);
        this.onAdError = this.onAdError.bind(this);

        this.closeVideoAction = function() {};
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

    startVideoLater(videoStream, showControlBar) {
        this.stopOldVideo(videoStream);
        setTimeout(() => this.startVideo(videoStream, showControlBar), 1);
    }

    startVideo(videoStream, showControlBar) {
        this.stopOldVideo(videoStream);

        this.showControlBarInitially = showControlBar || false;

        if (videoStream) {
            this.videoStream = videoStream;
            this.initialVideoTime = 0;
            console.log(`starting video: ${videoStream.title}`);
        } else {
            videoStream = this.videoStream;
            if (!videoStream) {
                throw new Error('missing video stream');
            }
        }

        this.showLoadingSpinner(true);

        const video = document.createElement('div');
        video.id = 'bitmovin-player';

        const firstOverlayChild = this.videoOwner.firstChild;
        this.videoOwner.insertBefore(video, firstOverlayChild);

        this.refreshAdMarkers = true;
        const childNodes = this.adMarkersDiv.children;
        for (let i = childNodes.length - 1; i >= 0; i--) {
            this.adMarkersDiv.removeChild(childNodes[i]);
        }

        // Create Bitmovin player with advertising configuration
        const config = {
            key: '6108af96-cc35-44b1-82bc-86ed6c1aa1c1',
            ui: false,
            playback: {
                autoplay: false,
                muted: false
            },
            advertising: {
                admessage: 'Ad',
                adMessageCountdown: false,
                schedule: [
                    {
                        tag: {
                            type: 'vast',
                            url: vastAdPlaylist,
                            adsResponse: vastAdPlaylist
                        }
                    }
                ]
            }
        };

        this.player = new bitmovin.player.Player(video, config);

        // Use HLS stream
        const hlsUrl = 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8';

        this.player.load({
            hls: hlsUrl,
            title: videoStream.title || 'Demo Video',
            poster: videoStream.cover
        }).then(() => {
            console.log('Video source loaded successfully');
            this.setupAdListeners();
            this.player.play();
        }).catch((error) => {
            console.error('Error loading video source:', error);
            this.showLoadingSpinner(false);
        });

        this.player.on(bitmovin.player.PlayerEvent.Playing, this.onVideoStarted);
        this.player.on(bitmovin.player.PlayerEvent.TimeChanged, this.onVideoTimeUpdate);
    }

    setupAdListeners() {
        // Get the IMA ads manager from Bitmovin
        const adsApi = this.player.ads;
        if (!adsApi) {
            console.error('Bitmovin advertising API not available');
            return;
        }

        // Access the underlying IMA SDK through Bitmovin
        // Note: This may vary depending on Bitmovin version
        this.adsManager = adsApi;

        // Listen for ad events
        this.player.on(bitmovin.player.PlayerEvent.AdStarted, (event) => {
            console.log('Ad started:', event);
            this.onAdEvent(event);
        });

        this.player.on(bitmovin.player.PlayerEvent.AdFinished, (event) => {
            console.log('Ad finished:', event);
        });

        this.player.on(bitmovin.player.PlayerEvent.AdSkipped, (event) => {
            console.log('Ad skipped:', event);
        });

        this.player.on(bitmovin.player.PlayerEvent.AdError, (event) => {
            console.error('Ad error:', event);
            this.onAdError(event);
        });
    }

    onAdEvent(event) {
        // TODO: Implement proper ad event handling with true[X] integration
        console.log('onAdEvent:', event);
    }

    onAdError(event) {
        console.error("ad error:", event);
    }

    stopOldVideo(newVideoStream) {
        if (this.player) {
            if (newVideoStream && this.videoStream === newVideoStream) {
                return;
            } else {
                this.stopVideo();
            }
        }
    }

    stopVideo() {
        this.hideControlBar();
        this.showLoadingSpinner(false);

        if (!this.player) return;

        this.player.destroy();
        this.player = null;

        this.adBreakTimes = null;
        this.seekTarget = undefined;
        this.adsManager = null;

        const playerContainer = this.videoOwner.querySelector('#bitmovin-player');
        if (playerContainer && playerContainer.parentNode) {
            playerContainer.parentNode.removeChild(playerContainer);
        }
    }

    showPlayer(visible) {
        if (visible) {
            this.videoOwner.classList.add('show');
        } else {
            this.videoOwner.classList.remove('show');
        }
    }

    playVideo() {
        if (!this.player) return;
        console.log('video playing at: ' + timeLabelOf(this.initialVideoTime));
        this.videoStarted = false;
        this.currVideoTime = this.initialVideoTime;
        this.player.play();
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
        if (this.currentAd) {
            return this.currentAdPaused;
        }

        if (this.playPromise) return false;
        return !this.player || this.player.isPaused();
    }

    play() {
        if (this.currentAd) {
            this.currentAdPaused = false;
            console.log("resumed ad playback");
            // Resume ad through Bitmovin API
            return;
        }

        if (!this.player) return;
        if (this.playPromise) return;
        if (this.debug) console.log(`play from: ${timeLabelOf(this.currVideoTime)}`);
        setTimeout(() => {
            if (!this.player) return;
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

        if (this.currentAd) {
            this.currentAdPaused = true;
            console.log("paused ad playback");
            // Pause ad through Bitmovin API
            return;
        }

        if (!this.player) return;
        if (this.playPromise) return;
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
        if (this.currentAd) {
            this.showControlBar();
            return;
        }

        if (!this.player) return;
        const currTime = this.currVideoTime;

        let seekStep = 10;
        const seekChunks = 80;
        const duration = this.getVideoDuration();
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
        if (this.playPromise) return;
        if (showControlBar === undefined) showControlBar = true;

        const currTime = this.currVideoTime;
        if (currTime == newTarget) return;

        const player = this.player;

        const duration = this.getVideoDuration();
        const maxTarget = duration > 0 ? duration : newTarget;

        this.seekTarget = Math.max(0, Math.min(newTarget, maxTarget));

        console.log(`seek to: ${timeLabelOf(this.seekTarget)}`);

        if (player) {
            player.seek(this.seekTarget);
        } else {
            this.initialVideoTime = newTarget;
        }

        if (showControlBar) {
            this.showControlBar();
        }
    }

    onControlBarClick(event) {
        event.stopImmediatePropagation();
        event.preventDefault();

        const timelineBounds = this.timeline.getBoundingClientRect();
        const mouseX = event.clientX;
        if (mouseX < timelineBounds.left) {
            this.togglePlayPause();
        } else {
            if (this.currentAd) return;
            const timelineX = Math.max(0, mouseX - timelineBounds.left);
            const timelineRatio = timelineX / timelineBounds.width;
            const videoDuration = this.getVideoDuration();
            this.seekTo(videoDuration * timelineRatio);
        }
    }

    skipAdBreak() {
        console.log('Skip ad break requested');
        // TODO: Implement through Bitmovin API
        this.hideControlBar();
    }

    resumeAdPlayback() {
        console.log("resumed ad playback");
        // TODO: Implement through Bitmovin API
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

        const newTime = this.player.getCurrentTime();
        if (this.debug) console.log('video time: ' + timeLabelOf(newTime));

        const currTime = this.currVideoTime;
        if (newTime == currTime) return;
        this.currVideoTime = newTime;
        this.seekTarget = undefined;

        this.showLoadingSpinner(false);

        this.refresh();
    }

    getVideoDuration() {
        const duration = this.player && this.player.getDuration() || 0;
        return duration;
    }

    refresh() {
        const ad = this.currentAd;
        const adProgress = this.currentAdProgress;
        const durationToDisplay = ad ? ad.getDuration() : this.getVideoDuration();
        const currTime = ad ? (adProgress ? adProgress.currentTime : 0) : this.currVideoTime;

        if (ad) {
            this.adIndicator.classList.add('show');
        } else {
            this.adIndicator.classList.remove('show');
        }

        if (!this.isControlBarVisible) {
            return;
        }

        if (this.isPaused()) {
            this.playButton.classList.add('show');
            this.pauseButton.classList.remove('show');
        } else {
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
