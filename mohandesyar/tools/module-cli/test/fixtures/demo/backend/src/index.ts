import { Controller, Get } from '@nestjs/common';
import { greet } from './helper';

@Controller('x')
export class XController {
  @Get() get() { return greet('x'); }
}
export default { controllers: [XController] };
