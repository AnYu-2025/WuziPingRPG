/* 免疫 · 偏难重点题 */
export const BANK_IMMUNO=[
 {id:'im01',subject:'免疫',difficulty:3,tag:'重点',q:'唯一能通过胎盘的免疫球蛋白是？',options:['IgG','IgM','IgA','IgE'],answer:0,explain:'IgG经胎盘FcRn转运给胎儿，是新生儿抗感染主力；SIgA经初乳提供黏膜免疫。'},
 {id:'im02',subject:'免疫',difficulty:2,tag:'偏',q:'分泌型IgA（SIgA）主要存在于？',options:['黏膜分泌液（初乳、唾液、肠液）','血清','脑脊液','细胞内'],answer:0,explain:'SIgA为二聚体+分泌片，存在于外分泌液，是黏膜局部免疫主力。'},
 {id:'im03',subject:'免疫',difficulty:3,tag:'偏',q:'分子量最大的免疫球蛋白是？',options:['IgM（五聚体）','IgG','IgA','IgE'],answer:0,explain:'IgM为五聚体，分子量最大，是初次应答最早抗体，激活补体能力强。'},
 {id:'im04',subject:'免疫',difficulty:2,tag:'重点',q:'与I型超敏反应结合的细胞是？',options:['肥大细胞/嗜碱性粒细胞（经IgE FcεRI）','T细胞','中性粒细胞','红细胞'],answer:0,explain:'IgE Fc段结合肥大细胞/嗜碱粒细胞FcεRI，再次接触抗原交联IgE致脱颗粒。'},
 {id:'im05',subject:'免疫',difficulty:3,tag:'偏',q:'II型超敏反应的典型疾病是？',options:['新生儿溶血症','血清病','接触性皮炎','过敏性哮喘'],answer:0,explain:'II型为抗体（IgG/IgM）介导细胞毒：新生儿溶血、自身免疫性溶血、甲亢（刺激型）；血清病III型、接触性皮炎IV型。'},
 {id:'im06',subject:'免疫',difficulty:2,tag:'重点',q:'III型超敏反应的机制是？',options:['免疫复合物沉积激活补体','IgE介导','抗体直接细胞毒','T细胞介导'],answer:0,explain:'III型为中等大小可溶性免疫复合物沉积于血管壁/肾小球，激活补体致损伤，如血清病、链球菌后肾炎、SLE。'},
 {id:'im07',subject:'免疫',difficulty:3,tag:'偏',q:'IV型超敏反应的介导者是？',options:['致敏T细胞与巨噬细胞','抗体','补体','IgE'],answer:0,explain:'IV型为T细胞介导迟发型，48–72h高峰，如接触性皮炎、结核菌素反应、移植排斥。'},
 {id:'im08',subject:'免疫',difficulty:2,tag:'偏',q:'补体经典途径的激活物是？',options:['抗原抗体复合物（IgG/IgM）','细菌脂多糖','酵母多糖','凝聚IgA'],answer:0,explain:'经典途径由Ag-Ab复合物激活C1q；旁路由LPS/酵母多糖；MBL由甘露糖残基。'},
 {id:'im09',subject:'免疫',difficulty:3,tag:'重点',q:'补体三条途径共同的末端效应是？',options:['形成膜攻击复合物MAC（C5b-9）','产生C3转化酶','释放过敏毒素','调理吞噬'],answer:0,explain:'三条途径汇于C5，形成C5b-9膜攻击复合物溶菌溶细胞；C3a/C5a为过敏毒素，C3b调理。'},
 {id:'im10',subject:'免疫',difficulty:2,tag:'重点',q:'MHC I类分子提呈抗原给？',options:['CD8+ T细胞','CD4+ T细胞','B细胞','NK细胞'],answer:0,explain:'MHC I提呈内源性抗原给CD8+ CTL；MHC II提呈外源性抗原给CD4+ Th。'},
 {id:'im11',subject:'免疫',difficulty:3,tag:'偏',q:'NK细胞杀伤靶细胞的特点是？',options:['不受MHC限制、无需预先致敏','受MHC I限制','需抗体参与','需补体'],answer:0,explain:'NK为非特异性杀伤，不受MHC限制；通过"丢失自我"（MHC I下调）识别，ADCC时借IgG。'},
 {id:'im12',subject:'免疫',difficulty:2,tag:'偏',q:'ADCC作用中识别靶细胞的分子是？',options:['IgG抗体','IgM','补体','MHC'],answer:0,explain:'ADCC中IgG Fab结合靶细胞，Fc与NK/巨噬细胞FcγR结合触发杀伤。'},
 {id:'im13',subject:'免疫',difficulty:3,tag:'重点',q:'T细胞活化第二信号（共刺激）主要来自？',options:['B7（CD80/86）与CD28','TCR与MHC','CD4与MHC II','LFA-1与ICAM'],answer:0,explain:'第一信号TCR-pMHC，第二信号B7-CD28；缺第二信号致T细胞无能（anergy）。'},
 {id:'im14',subject:'免疫',difficulty:2,tag:'重点',q:' CTL 杀伤靶细胞的主要机制是？',options:['穿孔素/颗粒酶与FasL途径','释放抗体','激活补体','吞噬'],answer:0,explain:'CTL经穿孔素打孔+颗粒酶诱导凋亡，或FasL结合靶细胞Fas诱导凋亡。'},
 {id:'im15',subject:'免疫',difficulty:3,tag:'偏',q:'Th1细胞主要分泌？',options:['IFN-γ、IL-2','IL-4、IL-5','IL-10、TGF-β','IL-17'],answer:0,explain:'Th1分泌IFN-γ/IL-2促细胞免疫；Th2分泌IL-4/5促体液/抗寄生虫；Treg分泌IL-10/TGF-β抑制。'},
 {id:'im16',subject:'免疫',difficulty:2,tag:'偏',q:'诱导免疫耐受最容易成功的时期是？',options:['胚胎期','成年期','老年期','任何时期相同'],answer:0,explain:'胚胎期免疫系统未成熟，接触抗原易致耐受（Burnet克隆选择学说）；成年期较难。'},
 {id:'im17',subject:'免疫',difficulty:3,tag:'重点',q:'人工被动免疫的例子是？',options:['注射破伤风抗毒素（TAT）','接种卡介苗','接种乙肝疫苗','口服脊灰糖丸'],answer:0,explain:'被动免疫=直接给抗体（TAT、免疫球蛋白），起效快维持短；疫苗为主动免疫。'},
 {id:'im18',subject:'免疫',difficulty:3,tag:'偏',q:'移植排斥反应主要针对？',options:['供者MHC（HLA）','供者ABO血型 alone','供者线粒体','供者细胞质蛋白'],answer:0,explain:'同种异体移植排斥主要由供者MHC（HLA）差异引起，故需配型+免疫抑制。'},
 {id:'im19',subject:'免疫',difficulty:2,tag:'偏',q:'超急性排斥反应的原因是？',options:['受者预存抗供者抗体（ABO/HLA）','T细胞致敏','免疫复合物','NK细胞'],answer:0,explain:'超急性排斥由受者预存抗体（血型不符或预存HLA抗体）介导，数分钟至数小时发生，属II/III型。'},
 {id:'im20',subject:'免疫',difficulty:3,tag:'重点',q:'免疫缺陷病AIDS的特征性免疫学改变是？',options:['CD4+ T细胞进行性减少','CD8+ T细胞减少','B细胞减少','补体缺乏'],answer:0,explain:'HIV破坏CD4+ T细胞，CD4/CD8倒置，细胞免疫崩溃，机会感染与肿瘤。'}
];