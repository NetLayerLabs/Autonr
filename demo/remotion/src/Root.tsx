import React from 'react'
import { Composition } from 'remotion'
import { Autonr, AUTONR_DURATION, FPS } from './Autonr'

export const RemotionRoot: React.FC = () => (
  <Composition id="Autonr" component={Autonr} durationInFrames={AUTONR_DURATION} fps={FPS} width={1920} height={1080} />
)
