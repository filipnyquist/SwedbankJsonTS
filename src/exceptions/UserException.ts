/**
 * UserException - thrown for errors caused by invalid user input
 */
export class UserException extends Error {
  public readonly code: number;

  constructor(message: string, code: number = 0) {
    super(message);
    this.name = "UserException";
    this.code = code;
  }
}
