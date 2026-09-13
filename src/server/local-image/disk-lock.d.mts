export function withLocalImageMutex<T>(config:{python:string;repository:string;root:string},action:()=>Promise<T>):Promise<T>;
