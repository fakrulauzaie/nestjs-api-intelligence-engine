import { Controller, Get, Post, Body, Param, Delete, UseGuards, Put, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotesService } from './notes.service';
import { Note } from './entities/note.entity';
import { AuthGuard } from '../auth/auth.guard';
import { CreateNoteDto } from './dto/create-note.dto';

const ARCHIVED_NOTES_PATH = 'archived';
const COMPUTED_STATUS_PATH = ['computed', 'status'].join('/');

@Controller('notes')
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    @InjectRepository(Note)
    private readonly notesRepository: Repository<Note>, // Injected for the legacy endpoint
  ) { }

  // 1. Clean Write Endpoint
  @Post()
  async create(@Body() createNoteDto: CreateNoteDto): Promise<unknown> {
    return this.notesService.create(createNoteDto);
  }

  // 2. Clean Read Endpoint
  @Get()
  async findAll() {
    return this.notesService.findAll();
  }

  // Simple const path supported by the analyzer.
  @Get(ARCHIVED_NOTES_PATH)
  async findArchived() {
    return this.notesService.findArchived();
  }

  // 3. Guarded Endpoint
  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string) {
    await this.notesService.remove(+id);
    return { success: true, message: `Note ${id} deleted successfully` };
  }

  // 4. Intentionally Messy Legacy Endpoint
  @Put('legacy/:id')
  updateLegacy(@Param('id') id: string, @Body() body: any): Promise<any> {
    // Legacy unstructured code - inline validation, bad naming, messy promises
    return new Promise((resolve, reject) => {
      if (!body) {
        return reject(new HttpException('No body', HttpStatus.BAD_REQUEST));
      }

      const n_id = parseInt(id);
      if (isNaN(n_id)) {
        reject(new HttpException('Bad ID', HttpStatus.BAD_REQUEST));
      }

      this.notesRepository.findOne({ where: { id: n_id } })
        .then(res => {
          if (!res) {
            reject(new HttpException('Not found', HttpStatus.NOT_FOUND));
          } else {
            // some old commented out code
            // res.title = body.title ? body.title : res.title;

            let t = body.title;
            if (t == null || t == '') {
              // do nothing
            } else {
              res.title = t;
            }

            if (body.content !== undefined) res.content = body.content;

            // Random weird mutation
            if (body.archive == 'yes') {
              res.isArchived = true;
            }

            console.log('UPDATING NOTE', res.id);

            this.notesRepository.save(res)
              .then(saved => {
                resolve({
                  status: 'ok',
                  data: saved
                });
              })
              .catch(err => {
                console.error("error saving", err);
                reject(new HttpException('DB error', HttpStatus.INTERNAL_SERVER_ERROR));
              });
          }
        })
        .catch(err => {
          reject(new HttpException('Query error', HttpStatus.INTERNAL_SERVER_ERROR));
        });
    });
  }

  // Deliberately computed beyond the MVP's simple const rule.
  @Get(COMPUTED_STATUS_PATH)
  computedStatus() {
    return { status: 'ok' };
  }
}
