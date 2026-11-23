declare module "quadprog" {
  const qp: {
    solveQP(
      D: number[][],
      d: number[],
      A: number[][],
      b: number[],
      meq?: number,
    ): {
      solution: number[];
      message: string;
      value: number[];
    };
  };
  export default qp;
}
