import { Controller, Get } from '@nestjs/common';
import { greet } from './helper.js';

@Controller('x')
export class XController {
  @Get() get() { return greet('x'); }
}
export default { controllers: [XController] };
