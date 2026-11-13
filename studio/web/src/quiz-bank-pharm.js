/* 药理 · 偏难重点题 */
export const BANK_PHARM=[
 {id:'pm01',subject:'药理',difficulty:3,tag:'重点',q:'阿司匹林抗血小板聚集的机制是？',options:['不可逆抑制环氧酶，减少TXA2生成','可逆抑制环氧酶','抑制磷脂酶A2','阻断ADP受体'],answer:0,explain:'阿司匹林乙酰化COX-1不可逆抑制血小板TXA2合成，抗血小板；氯吡格雷阻断ADP受体。'},
 {id:'pm02',subject:'药理',difficulty:2,tag:'偏',q:'对乙酰氨基酚与阿司匹林的主要区别是？',options:['几乎无抗炎抗风湿作用','解热作用更强','抗血小板作用更强','胃肠道反应更重'],answer:0,explain:'对乙酰氨基酚解热镇痛但抗炎极弱、不抗血小板、胃肠刺激小，过量致肝坏死。'},
 {id:'pm03',subject:'药理',difficulty:3,tag:'重点',q:'吗啡镇痛的主要机制是激动？',options:['μ阿片受体','M受体','GABA受体','NMDA受体'],answer:0,explain:'吗啡激动μ受体产生镇痛、镇静、呼吸抑制、缩瞳、欣快；纳洛酮为拮抗剂。'},
 {id:'pm04',subject:'药理',difficulty:2,tag:'偏',q:'吗啡中毒的三联征是？',options:['昏迷、针尖样瞳孔、呼吸抑制','昏迷、瞳孔散大、呼吸加快','抽搐、高热、瞳孔散大','昏迷、血压升高、心动过速'],answer:0,explain:'吗啡急性中毒：昏迷、针尖样瞳孔、呼吸高度抑制，死于呼吸麻痹，纳洛酮解救。'},
 {id:'pm05',subject:'药理',difficulty:3,tag:'偏',q:'氯丙嗪引起锥体外系反应的机制是阻断？',options:['黑质-纹状体通路D2受体','中脑-边缘通路D2受体','结节-漏斗D2受体','α受体'],answer:0,explain:'阻断黑质-纹状体D2致锥体外系反应；阻断结节-漏斗D2致泌乳；抗精神病主要靠中脑-边缘/皮质通路。'},
 {id:'pm06',subject:'药理',difficulty:2,tag:'重点',q:'氯丙嗪配合物理降温可使体温？',options:['降至正常以下','只降发热体温','升高体温','不影响体温'],answer:0,explain:'氯丙嗪抑制下丘脑体温调节中枢，使体温随环境变化，配合物理降温用于人工冬眠。'},
 {id:'pm07',subject:'药理',difficulty:3,tag:'偏',q:'左旋多巴治疗帕金森病时合用卡比多巴的目的是？',options:['抑制外周多巴脱羧酶，增加入脑左旋多巴','抑制中枢COMT','激动多巴胺受体','阻断胆碱受体'],answer:0,explain:'卡比多巴为外周脱羧酶抑制剂，不入脑，减少左旋多巴外周脱羧，增加入脑量、减轻外周副作用。'},
 {id:'pm08',subject:'药理',difficulty:2,tag:'重点',q:'苯妥英钠治疗癫痫大发作的机制主要是？',options:['阻滞电压依赖性Na+通道','增强GABA','阻断Ca2+通道','激动NMDA'],answer:0,explain:'苯妥英钠阻滞Na+通道稳定膜，对大发作、局限发作有效，对小发作无效甚至加重。'},
 {id:'pm09',subject:'药理',difficulty:3,tag:'偏',q:'乙琥胺是治疗哪种癫痫的首选？',options:['失神小发作','大发作','癫痫持续状态','精神运动性发作'],answer:0,explain:'乙琥胺为失神小发作首选；丙戊酸钠为广谱；地西泮为癫痫持续状态首选。'},
 {id:'pm10',subject:'药理',difficulty:2,tag:'重点',q:'地西泮抗焦虑作用的主要部位是？',options:['边缘系统','脑干网状结构','脊髓','大脑皮质'],answer:0,explain:'小剂量地西泮作用于边缘系统抗焦虑；增大剂量镇静催眠、抗惊厥、中枢性肌松。'},
 {id:'pm11',subject:'药理',difficulty:3,tag:'偏',q:'苯二氮䓬类的作用机制是？',options:['增强GABA与GABAA受体结合，增加Cl-通道开放频率','直接开放Cl-通道','阻断GABA受体','延长Cl-通道开放时间（巴比妥类）'],answer:0,explain:'BZ增强GABA作用、增加Cl-通道开放频率；巴比妥类延长开放时间，二者机制不同。'},
 {id:'pm12',subject:'药理',difficulty:2,tag:'重点',q:'强心苷（地高辛）正性肌力机制是抑制？',options:['Na+-K+-ATP酶','磷酸二酯酶','Ca2+通道','β受体'],answer:0,explain:'抑制Na+-K+-ATP酶→细胞内Na+↑→Na+-Ca2+交换使Ca2+↑→正性肌力；中毒致心律失常。'},
 {id:'pm13',subject:'药理',difficulty:3,tag:'偏',q:'地高辛中毒最常见的心脏表现是？',options:['室性早搏','窦性心动过速','房颤','一度房室传导阻滞'],answer:0,explain:'地高辛中毒心脏毒性以室性早搏最常见，亦见房室传导阻滞；低钾易诱发中毒。'},
 {id:'pm14',subject:'药理',difficulty:2,tag:'偏',q:'硝酸甘油抗心绞痛主要机制是？',options:['扩张静脉降低前负荷、降低心肌耗氧','扩张冠状动脉为主','增强心肌收缩力','加快心率'],answer:0,explain:'硝酸甘油释放NO，扩张静脉（降低前负荷）为主，降低耗氧；亦扩张冠脉及侧支。'},
 {id:'pm15',subject:'药理',difficulty:3,tag:'重点',q:'普萘洛尔抗心绞痛的不利作用是？',options:['增大心室容积、延长射血时间','降低心率','降低心肌耗氧','降低血压'],answer:0,explain:'β阻滞使心率减慢、舒张期延长、心室容积增大，反而增加耗氧，故常与硝酸酯类合用取长补短。'},
 {id:'pm16',subject:'药理',difficulty:2,tag:'重点',q:'ACEI（卡托普利）降压机制不包括？',options:['抑制缓激肽降解','抑制血管紧张素II生成','减少醛固酮','直接阻断AT1受体'],answer:3,explain:'ACEI抑制ACE使AngII↓、缓激肽↑；直接阻断AT1受体的是ARB（氯沙坦）。'},
 {id:'pm17',subject:'药理',difficulty:3,tag:'偏',q:'ACEI最常见的不良反应是？',options:['干咳','低血钾','心动过速','高血糖'],answer:0,explain:'ACEI使缓激肽积聚致干咳；可致高血钾（醛固酮减少），而非低血钾。'},
 {id:'pm18',subject:'药理',difficulty:2,tag:'偏',q:'呋塞米的作用部位是？',options:['髓袢升支粗段','近端小管','远曲小管','集合管'],answer:0,explain:'呋塞米抑制髓袢升支粗段Na+-K+-2Cl-同向转运体，为高效能利尿药；噻嗪类作用于远曲小管。'},
 {id:'pm19',subject:'药理',difficulty:3,tag:'重点',q:'螺内酯的利尿机制是？',options:['拮抗醛固酮受体','抑制Na+-K+-2Cl-转运','抑制碳酸酐酶','抑制Na+-Cl-转运'],answer:0,explain:'螺内酯为醛固酮拮抗剂，保钾排钠，作用弱、起效慢，用于伴醛固酮增多的水肿。'},
 {id:'pm20',subject:'药理',difficulty:3,tag:'偏',q:'华法林抗凝的机制是？',options:['抑制维生素K依赖凝血因子（II VII IX X）合成','增强抗凝血酶III','直接抑制凝血酶','抑制血小板'],answer:0,explain:'华法林拮抗维生素K，抑制II、VII、IX、X及蛋白C/S合成，体外无效、起效慢；肝素增强ATIII。'}
];