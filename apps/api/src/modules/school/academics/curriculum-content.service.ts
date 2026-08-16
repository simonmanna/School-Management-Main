import { Injectable } from '@nestjs/common';
import type {
  Competency,
  Topic,
  Unit,
  LearningObjective,
} from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type {
  CreateCompetencyDto,
  CreateTopicDto,
  CreateUnitDto,
  CreateLearningObjectiveDto,
  UpdateCompetencyDto,
  UpdateTopicDto,
  UpdateUnitDto,
  UpdateLearningObjectiveDto,
} from './dto.types';

@Injectable()
export class CompetencyService extends BaseCrudService<Competency, CreateCompetencyDto, UpdateCompetencyDto> {
  protected readonly entityName = 'Competency';
  protected readonly searchFields = ['code', 'description'];

  constructor(prisma: PrismaService) {
    super(prisma.client.competency as unknown as CrudDelegate);
  }
}

@Injectable()
export class TopicService extends BaseCrudService<Topic, CreateTopicDto, UpdateTopicDto> {
  protected readonly entityName = 'Topic';
  protected readonly searchFields = ['title'];
  protected readonly defaultInclude = { units: { include: { learningObjectives: true } } };

  constructor(prisma: PrismaService) {
    super(prisma.client.topic as unknown as CrudDelegate);
  }
}

@Injectable()
export class UnitService extends BaseCrudService<Unit, CreateUnitDto, UpdateUnitDto> {
  protected readonly entityName = 'Unit';
  protected readonly searchFields = ['title'];
  protected readonly defaultInclude = { learningObjectives: true };

  constructor(prisma: PrismaService) {
    super(prisma.client.unit as unknown as CrudDelegate);
  }
}

@Injectable()
export class LearningObjectiveService extends BaseCrudService<LearningObjective, CreateLearningObjectiveDto, UpdateLearningObjectiveDto> {
  protected readonly entityName = 'LearningObjective';
  protected readonly searchFields = ['description'];

  constructor(prisma: PrismaService) {
    super(prisma.client.learningObjective as unknown as CrudDelegate);
  }
}
