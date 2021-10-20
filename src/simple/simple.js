import { main } from '../main';
import { SimpleVideoController } from './simple-video-controller';

/**
 * Demonstrates the direct use of the client-side IMA SDK. I.e. we implement the video player ourselves,
 * the idea being that approach should be generalizable to any player.
 */
main(SimpleVideoController);