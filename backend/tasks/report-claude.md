# ArmPilot Eval Report

- date: 2026-06-11 10:59
- planner: **claude**
- tasks: 20
- **success rate: 20/20 (100%)**

## By family

| family | passed | total |
|---|---|---|
| in_plate | 8 | 8 |
| on_block | 4 | 4 |
| in_zone | 4 | 4 |
| holding | 2 | 2 |
| multi | 2 | 2 |

## Tasks

| # | family | instruction | result | wall (s) | ground-truth detail |
|---|---|---|---|---|---|
| 1 | in_plate | 把红色方块放进蓝色盘子 | ✅ | 40.4 | red_block is 2mm from blue_plate center, z=0.030 |
| 2 | in_plate | Put the green block in the blue plate | ✅ | 29.7 | green_block is 2mm from blue_plate center, z=0.030 |
| 3 | in_plate | 把蓝色方块放到白色盘子里 | ✅ | 28.4 | blue_block is 2mm from white_plate center, z=0.030 |
| 4 | in_plate | place the yellow block on the white plate | ✅ | 32.1 | yellow_block is 1mm from white_plate center, z=0.030 |
| 5 | in_plate | 把黄色方块放进蓝色盘子 | ✅ | 26.6 | yellow_block is 3mm from blue_plate center, z=0.030 |
| 6 | in_plate | Put the red block in the white plate | ✅ | 29.5 | red_block is 6mm from white_plate center, z=0.030 |
| 7 | in_plate | 把绿色积木放进蓝色盘子里 | ✅ | 33.3 | green_block is 3mm from blue_plate center, z=0.030 |
| 8 | in_plate | put the blue cube in the blue plate | ✅ | 32.3 | blue_block is 1mm from blue_plate center, z=0.030 |
| 9 | on_block | 把蓝色方块叠到绿色方块上面 | ✅ | 31.5 | horiz offset 3mm, dz 40mm |
| 10 | on_block | Stack the red block on the yellow block | ✅ | 28.9 | horiz offset 4mm, dz 40mm |
| 11 | on_block | 把绿色积木叠在红色积木上面 | ✅ | 29.7 | horiz offset 3mm, dz 40mm |
| 12 | on_block | stack the yellow cube onto the blue cube | ✅ | 31.5 | horiz offset 5mm, dz 40mm |
| 13 | in_zone | 把黄色方块移到左边区域 | ✅ | 30.3 | yellow_block at [0.3501, 0.2996, 0.0199], zone center [0.35, 0.3, 0.0005] |
| 14 | in_zone | Move the red block to the right zone | ✅ | 36.4 | red_block at [0.3475, -0.2973, 0.0199], zone center [0.35, -0.3, 0.0005] |
| 15 | in_zone | 把蓝色方块移动到右边区域 | ✅ | 33.7 | blue_block at [0.3504, -0.3, 0.0199], zone center [0.35, -0.3, 0.0005] |
| 16 | in_zone | move the green block to the left zone | ✅ | 27.7 | green_block at [0.3524, 0.3062, 0.0199], zone center [0.35, 0.3, 0.0005] |
| 17 | holding | 拿起绿色方块 | ✅ | 17.5 | gripper is holding green_block |
| 18 | holding | Pick up the blue block | ✅ | 19.9 | gripper is holding blue_block |
| 19 | multi | 把红色方块和绿色方块都放进白色盘子 | ✅ | 58.7 | red_block is 22mm from white_plate center, z=0.030; green_block is 19mm from white_plate center, z=0.030 |
| 20 | multi | Put the yellow block and the blue block in the blue plate | ✅ | 87.7 | yellow_block is 21mm from blue_plate center, z=0.030; blue_block is 20mm from blue_plate center, z=0.030 |
