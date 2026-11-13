/* 生化 · 偏难重点题 */
export const BANK_BIOCHEM=[
 {id:'bc01',subject:'生化',difficulty:3,tag:'重点',q:'糖酵解途径中最重要的限速酶是？',options:['己糖激酶','6-磷酸果糖激酶-1','丙酮酸激酶','葡萄糖激酶'],answer:1,explain:'PFK-1是糖酵解最关键的限速酶，受ATP/柠檬酸抑制、AMP/2,6-双磷酸果糖激活。'},
 {id:'bc02',subject:'生化',difficulty:3,tag:'偏',q:'三羧酸循环中底物水平磷酸化生成GTP的步骤是？',options:['异柠檬酸→α-酮戊二酸','琥珀酰CoA→琥珀酸','苹果酸→草酰乙酸','柠檬酸→异柠檬酸'],answer:1,explain:'琥珀酰CoA合成酶催化琥珀酰CoA→琥珀酸，偶联GTP生成，是唯一底物水平磷酸化步骤。'},
 {id:'bc03',subject:'生化',difficulty:2,tag:'重点',q:'1分子乙酰CoA经三羧酸循环彻底氧化生成ATP约？',options:['2','10','12','30'],answer:1,explain:'按现行P/O比，1乙酰CoA经TCA生成3NADH+1FADH2+1GTP≈10 ATP。'},
 {id:'bc04',subject:'生化',difficulty:3,tag:'偏',q:'磷酸戊糖途径的主要生理意义是？',options:['生成NADPH和5-磷酸核糖','大量生成ATP','生成乳酸','生成尿素'],answer:0,explain:'磷酸戊糖途径提供NADPH（合成代谢、抗氧化）与5-磷酸核糖（核苷酸合成），不产ATP。'},
 {id:'bc05',subject:'生化',difficulty:2,tag:'重点',q:'G6PD缺乏症患者易发生溶血，原因是缺乏？',options:['NADPH导致还原型谷胱甘肽不足','ATP不足','5-磷酸核糖','NADH'],answer:0,explain:'G6PD缺乏使NADPH不足，还原型谷胱甘肽减少，红细胞易受氧化损伤而溶血（蚕豆病）。'},
 {id:'bc06',subject:'生化',difficulty:3,tag:'偏',q:'糖异生的关键酶不包括？',options:['丙酮酸羧化酶','PEP羧激酶','果糖双磷酸酶-1','丙酮酸激酶'],answer:3,explain:'糖异生关键酶为丙酮酸羧化酶、PEP羧激酶、果糖双磷酸酶-1、葡萄糖-6-磷酸酶；丙酮酸激酶是糖酵解酶。'},
 {id:'bc07',subject:'生化',difficulty:2,tag:'重点',q:'脂肪酸β-氧化的产物不包括？',options:['乙酰CoA','NADH','FADH2','NADPH'],answer:3,explain:'β-氧化每轮生成1乙酰CoA+1NADH+1FADH2；NADPH来自磷酸戊糖途径，用于合成而非氧化。'},
 {id:'bc08',subject:'生化',difficulty:3,tag:'偏',q:'酮体生成的器官是？',options:['肝脏','肾脏','肌肉','脑'],answer:0,explain:'酮体（乙酰乙酸、β-羟丁酸、丙酮）只在肝脏线粒体生成，肝外组织利用；肝缺乏利用酮体的酶。'},
 {id:'bc09',subject:'生化',difficulty:2,tag:'重点',q:'胆固醇合成的限速酶是？',options:['HMG-CoA还原酶','HMG-CoA合成酶','乙酰CoA羧化酶','脂蛋白脂肪酶'],answer:0,explain:'HMG-CoA还原酶是胆固醇合成限速酶，是他汀类降脂药的作用靶点。'},
 {id:'bc10',subject:'生化',difficulty:3,tag:'偏',q:'乙酰CoA羧化酶催化生成？',options:['丙二酸单酰CoA','乙酰乙酸','HMG-CoA','琥珀酰CoA'],answer:0,explain:'乙酰CoA羧化酶（生物素依赖）催化乙酰CoA→丙二酸单酰CoA，是脂肪酸合成限速步骤。'},
 {id:'bc11',subject:'生化',difficulty:3,tag:'重点',q:'尿素循环中氨基甲酰磷酸合成酶I的变构激活剂是？',options:['N-乙酰谷氨酸','精氨酸','谷氨酰胺','ATP'],answer:0,explain:'CPS-I是尿素循环限速酶，需N-乙酰谷氨酸（AGA）变构激活；CPS-II参与嘧啶合成。'},
 {id:'bc12',subject:'生化',difficulty:2,tag:'偏',q:'血氨升高主要见于？',options:['肝功能严重受损','肾功能衰竭','糖尿病','甲亢'],answer:0,explain:'肝是合成尿素解氨毒的主要器官，肝衰时血氨升高，可致肝性脑病。'},
 {id:'bc13',subject:'生化',difficulty:3,tag:'偏',q:'嘌呤核苷酸分解的终产物是？',options:['尿酸','尿素','肌酐','氨'],answer:0,explain:'人体嘌呤分解终产物为尿酸，过多致痛风；嘧啶分解产物为β-氨基酸、NH3、CO2。'},
 {id:'bc14',subject:'生化',difficulty:2,tag:'重点',q:'别嘌呤醇治疗痛风的机制是抑制？',options:['黄嘌呤氧化酶','尿酸酶','PRPP合成酶','腺苷脱氨酶'],answer:0,explain:'别嘌呤醇抑制黄嘌呤氧化酶，减少尿酸生成，用于痛风治疗。'},
 {id:'bc15',subject:'生化',difficulty:3,tag:'偏',q:'DNA复制中冈崎片段出现在？',options:['随从链','领头链','两条链','模板链'],answer:0,explain:'随从链不连续合成，先形成冈崎片段再连接；领头链连续合成。'},
 {id:'bc16',subject:'生化',difficulty:2,tag:'重点',q:'逆转录酶催化？',options:['以RNA为模板合成DNA','以DNA为模板合成RNA','以DNA为模板合成DNA','以RNA为模板合成RNA'],answer:0,explain:'逆转录酶以RNA为模板合成DNA（cDNA），见于逆转录病毒如HIV。'},
 {id:'bc17',subject:'生化',difficulty:3,tag:'偏',q:'真核mRNA转录后5′端加？',options:['7-甲基鸟苷帽（m7Gppp）','polyA尾','内含子','CCA尾'],answer:0,explain:'真核mRNA 5′端加m7G帽、3′端加polyA尾，利于稳定与翻译起始；tRNA 3′端为CCA。'},
 {id:'bc18',subject:'生化',difficulty:2,tag:'偏',q:'tRNA 3′端的共同序列是？',options:['CCA','AAA','polyA','TΨC'],answer:0,explain:'tRNA 3′端均为CCA-OH，是氨基酸结合位点。'},
 {id:'bc19',subject:'生化',difficulty:3,tag:'重点',q:'镰刀型红细胞贫血的分子基础是？',options:['β珠蛋白第6位谷氨酸→缬氨酸','α珠蛋白缺失','β珠蛋白第6位谷氨酸→赖氨酸','血红素合成障碍'],answer:0,explain:'HbS为β链第6位Glu→Val（点突变），脱氧时聚合使红细胞镰变。'},
 {id:'bc20',subject:'生化',difficulty:3,tag:'偏',q:'一氧化碳中毒的机制是抑制？',options:['细胞色素c氧化酶（Cytaa3）','NADH脱氢酶','琥珀酸脱氢酶','ATP合酶'],answer:0,explain:'CO与氰化物抑制呼吸链复合体IV（Cytaa3），阻断电子传递给氧，致细胞内窒息。'}
];