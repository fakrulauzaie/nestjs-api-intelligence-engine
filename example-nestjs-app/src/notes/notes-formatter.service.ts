import { Injectable } from '@nestjs/common';
import { Note } from './entities/note.entity';

@Injectable()
export class NotesFormatterService {
  normalize(noteData: Partial<Note>): Partial<Note> {
    return {
      ...noteData,
      title: noteData.title?.trim(),
    };
  }
}
