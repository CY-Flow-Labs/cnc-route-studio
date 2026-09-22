const demoProgram = `%
O1000 (SYNTHETIC DEMO - NOT FOR MACHINE USE)
G21 G17 G40 G49 G80 G90
G54 G0 X0 Y0 Z20
G1 Z0 F200
G1 X80 F500
G3 Y40 R20
G1 X0
G3 Y0 R20
G0 Z20
M30
%`;

export const sampleA = demoProgram;
export const sampleB = demoProgram;
