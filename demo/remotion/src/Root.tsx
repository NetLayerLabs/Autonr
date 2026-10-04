import React from 'react'
import { Composition } from 'remotion'
import { FILM_FRAMES, Film } from './Film'
import { FPS, H, W } from './theme'

export const RemotionRoot: React.FC = () => (
  <Composition id="Autonr" component={Film} durationInFrames={FILM_FRAMES} fps={FPS} width={W} height={H} />
)
