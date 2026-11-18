package cn.wuziping.ember;

/** 学科特色关卡：每个学院一道三问试炼，题目取自真实校史与学科常识。
 *  接取委托后先试炼、再清剿；答错不惩罚，只补一句讲解。 */
public final class AcademyTrial {
    public static final class Q{
        public final String q;public final String[] opts;public final int a;public final String why;
        Q(String q,String[] o,int a,String w){this.q=q;opts=o;this.a=a;why=w;}
    }
    /** 索引与 OpenWorld 区域 id 对齐；-1 表示该区域无试炼。 */
    public static final Q[][] TRIALS=new Q[11][];
    static{
        TRIALS[OpenWorld.SOUTH]=new Q[]{
            new Q("1923 年孙中山在怀士堂演讲，勉励青年哪句话？",new String[]{"立志做大事，不可做大官","学而优则仕","实业救国"},0,"「要立志做大事，不可做大官。」——怀士堂演讲，1923。"),
            new Q("康乐园红楼最典型的立面特征是？",new String[]{"红砖绿瓦","白墙黛瓦","青砖灰瓦"},0,"岭南大学时期建筑群以红砖墙身、绿琉璃瓦顶著称。"),
            new Q("「独立之精神，自由之思想」出自哪位曾居康乐园的先生？",new String[]{"陈寅恪","鲁迅","胡适"},0,"陈寅恪 1953 年起居康乐园东南区 309 号二楼。")};
        TRIALS[OpenWorld.NORTH]=new Q[]{
            new Q("中国近代第一所西医学府博济医学堂创办于？",new String[]{"1866 年","1901 年","1924 年"},0,"1866 年嘉约翰在博济医院内建博济医学堂。"),
            new Q("中山医红楼楹联「医病医身医心」的下联是？",new String[]{"救人救国救世","济人济物济天下","修身齐家治国"},0,"1927 年戴季陶题撰：医病医身医心，救人救国救世。"),
            new Q("柯麟老院长强调的「三基」指？",new String[]{"基本理论/基本知识/基本技能","基础/基层/基建","基本/根本/基石"},0,"三基三严是中山医教学传统的核心。")};
        TRIALS[OpenWorld.EAST]=new Q[]{
            new Q("东校园坐落广州大学城，又称？",new String[]{"小谷围岛","黄埔岛","生物岛"},0,"广州大学城位于小谷围岛，东校园在其东北端。"),
            new Q("国家超级计算广州中心位于哪个校园？",new String[]{"东校园","南校园","北校园"},0,"「天河二号」落户东校园。"),
            new Q("逻辑门 AND 的输出为 1，当且仅当？",new String[]{"两输入皆 1","任一输入 1","两输入皆 0"},0,"与门：全 1 出 1，有 0 出 0。")};
        TRIALS[OpenWorld.ZHUHAI]=new Q[]{
            new Q("珠海校区东临哪片海？",new String[]{"南海","东海","黄海"},0,"珠海校区西拥凤凰山、东临南海。"),
            new Q("「天琴计划」是珠海校区主导的什么探测计划？",new String[]{"空间引力波","深海潜航","火星采样"},0,"天琴计划：空间引力波探测，罗俊院士发起。"),
            new Q("潮汐涨落的主要成因是？",new String[]{"月球与太阳引力","海底火山","季风"},0,"引潮力以月球为主、太阳为辅。")};
        TRIALS[OpenWorld.SHENZHEN]=new Q[]{
            new Q("深圳校区位于深圳哪个区？",new String[]{"光明区","南山区","福田区"},0,"深圳校区在光明区，山水相融、红墙绿瓦。"),
            new Q("深圳校区着力建设的学科方向是？",new String[]{"新医科新工科","纯文科","纯理科"},0,"17 个整建制学院，服务国家重大战略的新医科新工科。"),
            new Q("材料「强度」指？",new String[]{"抵抗破坏的能力","导电能力","透光能力"},0,"强度是材料抵抗外力破坏的能力。")};
        TRIALS[OpenWorld.MING_CITY]=new Q[]{
            new Q("明太祖朱元璋的年号是？",new String[]{"洪武","永乐","崇祯"},0,"洪武（1368—1398）。"),
            new Q("明代「南直隶」的治所在？",new String[]{"应天府","顺天府","西安府"},0,"南直隶治应天（南京），北直隶治顺天。"),
            new Q("锦衣卫在明代本职是？",new String[]{"侍卫仪仗兼缉事","管科举","管漕运"},0,"锦衣卫掌侍卫、仪仗，后兼巡察缉捕。")};
        TRIALS[OpenWorld.MING_TRIBE]=new Q[]{
            new Q("南明最后一个年号是？",new String[]{"永历","弘光","隆武"},0,"永历（1647—1662），桂王朱由榔。"),
            new Q("「衣冠不改」在遗民语境里意味着？",new String[]{"坚守故国文化认同","拒绝换季穿衣","禁止通婚"},0,"衣冠是文化认同的象征，非字面穿衣。"),
            new Q("滇黔「土司」制度核心是？",new String[]{"世袭地方首领自治","科举取士","流官三年一任"},0,"土司世袭其地、世长其民，中央册封。")};
        TRIALS[OpenWorld.SUNKEN_MING]=new Q[]{
            new Q("淮泗水患沉没的「明土」临近哪条河？",new String[]{"淮河","珠江","塔里木河"},0,"洪泽湖一带淮泗泛溢，泗州城沉没。"),
            new Q("泗州城沉没于哪个朝代？",new String[]{"清康熙年间","唐","元"},0,"康熙十九年（1680）泗州城沉入洪泽湖。"),
            new Q("「沧海桑田」形容的是？",new String[]{"海陆变迁","季节更替","人事代谢"},0,"大海变桑田，喻地理与世事巨变。")};
        TRIALS[OpenWorld.MING_RUIN]=new Q[]{
            new Q("明中都诏建与罢建分别在？",new String[]{"洪武二年/洪武八年","洪武元年/洪武五年","永乐二年/永乐八年"},0,"1369 诏建，1375 以「劳费」罢建。"),
            new Q("明中都午门须弥座束腰浮雕以什么纹样著称？",new String[]{"龙凤麒麟等 11 种","仅花卉","仅云纹"},0,"421 个纹样、约 350 米长，现存最精美城台须弥座。"),
            new Q("明中都前朝区主殿出土的巨型构件是？",new String[]{"蟠龙石础","金砖","铜鼎"},0,"础面边长 2.5—2.6 米，古代宫殿基址出土体量最大石础。")};
        TRIALS[OpenWorld.RUIN_ANCIENT]=new Q[]{
            new Q("先民「观星定四时」主要依靠？",new String[]{"北斗与昏旦中星","占卜","梦境"},0,"斗柄指时、昏旦中星是上古授时法。"),
            new Q("「星火出于北辰」的北辰指？",new String[]{"北极星","太阳","月亮"},0,"北辰即北极星，众星拱之。"),
            new Q("星图刻碑最主要的功能是？",new String[]{"传承授时知识","装饰","记功"},0,"把授时知识刻石传世。")};
        TRIALS[OpenWorld.RUIN_MED]=new Q[]{
            new Q("中山医科大学并入中山大学在？",new String[]{"2001 年","1985 年","1953 年"},0,"2001 年 10 月合并，组建新中山大学。"),
            new Q("「三校合一」不含哪所？",new String[]{"湘雅医学院","岭南大学医学院","广东光华医学院"},0,"三校为中山医/岭南医/光华医，不含湘雅。"),
            new Q("解剖学「标准姿势」掌心朝向？",new String[]{"向前","向后","向内"},0,"解剖学姿势：身体直立、掌心向前。")};
    }
    public int region=-1,idx=0,correct=0,wrong=0;
    public boolean active=false,done=false;
    public Q current(){return active&&region>=0&&idx<TRIALS[region].length?TRIALS[region][idx]:null;}
    public void begin(Game g,int r){
        if(TRIALS[r]==null)return;
        region=r;idx=0;correct=0;wrong=0;active=true;done=false;
        ask(g);
    }
    private void ask(Game g){
        Q q=current();
        String[] pages=new String[]{"旁白|"+OpenWorld.REGIONS[region].name+" · 学科试炼 "+(idx+1)+"/"+TRIALS[region].length,q.q};
        g.story.begin(g,-1,pages,q.opts,new int[]{800,801,802});
    }
    public void answer(Game g,int pick){
        Q q=current();if(q==null){active=false;return;}
        boolean ok=pick==q.a;
        if(ok)correct++;else wrong++;
        String verdict=ok?"答对了。":"不对。正确答案："+q.opts[q.a]+"。";
        idx++;
        boolean last=idx>=TRIALS[region].length;
        if(last){active=false;done=true;}
        String tail=last?("试炼完成 · 答对 "+correct+"/"+TRIALS[region].length+"。去清剿郊外敌营吧。"):"下一问。";
        g.story.begin(g,-1,new String[]{"旁白|"+verdict,q.why,"旁白|"+tail},new String[]{last?"出发清剿":"继续"},new int[]{last?500:810});
    }
    public void next(Game g){if(active)ask(g);}
}