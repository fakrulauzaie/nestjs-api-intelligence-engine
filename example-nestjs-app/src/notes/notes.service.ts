import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InsertResult, Repository } from 'typeorm';
import { Note } from './entities/note.entity';
import { NotesFormatterService } from './notes-formatter.service';
import { CreateNoteDto } from './dto/create-note.dto';

@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note)
    private readonly notesRepository: Repository<Note>,
    private readonly notesFormatter: NotesFormatterService,
  ) {}

  async create(noteData: CreateNoteDto): Promise<InsertResult> {
    const normalizedNote = this.notesFormatter.normalize(noteData);
    return this.notesRepository.insert({
      title: noteData.title,
      content: normalizedNote.content,
    });
  }

  async findAll(): Promise<Note[]> {
    return this.notesRepository.find();
  }

  async findArchived(): Promise<Note[]> {
    return this.notesRepository.findBy({ isArchived: true });
  }

  async count(): Promise<number> {
    return this.notesRepository.count();
  }

  async remove(id: number): Promise<void> {
    const result = await this.notesRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }
  }

  // Similar name for a negative call-edge assertion; no controller calls this.
  async findAllBackup(): Promise<Note[]> {
    return this.notesRepository.find();
  }

  // Deliberately outside the MVP repository-operation catalogue.
  async unsupportedPreload(noteData: Partial<Note>): Promise<Note | undefined> {
    return this.notesRepository.preload(noteData);
  }
}
