/**
 * Describes a logical ad break to that is associated with a main video.
 * For truex ads, the first video in each ad break is assumed to be the placeholder video for the
 * true[X] interactive ad, and as such is not actually played but skipped over. All other ad videos
 * are simply played, whether they are fallback ad videos for incomplete or cancelled interactive ads,
 * or else 3rd party non-truex ad videos. For completed interactive ads, the entire ad break is skipped.
 */
export class AdBreak {
    constructor(startTime, index) {
        this.index = index;
        this.startTime = startTime;
        this.started = false;
        this.completed = false;
    }
}
