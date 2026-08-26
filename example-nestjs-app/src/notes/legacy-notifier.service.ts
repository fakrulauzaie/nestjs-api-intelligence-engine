import { Inject, Injectable } from '@nestjs/common';

export const LEGACY_SINK_TOKEN = 'LEGACY_SINK';

export interface LegacySink {
  write(message: string): void;
}

@Injectable()
export class LegacyNotifierService {
  constructor(
    @Inject(LEGACY_SINK_TOKEN)
    private readonly sink: LegacySink,
  ) { }

  notify(message: string): void {
    this.sink.write(message);
  }
}
