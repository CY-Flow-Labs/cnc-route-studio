const demoProgram = `%
O1000 (PUBLIC DEMO)
G21 G17 G40 G49 G80 G90
T1 M6
G54 G0 X0 Y0 Z50
S1200 M3
G0 X-40 Y-25 Z5
G1 Z-5 F200
G1 X40 F500
G2 X40 Y25 I0 J25
G1 X-40
G2 X-40 Y-25 I0 J-25
G0 Z50
M5
M30
%`;

export const sampleA = demoProgram;
export const sampleB = demoProgram.replace("O1000", "O1001").replace("X40 F500", "X35 F500");
