export const MATERIALS=[
 {id:'paper',label:'论文',tool:'search_papers',hint:''},
 {id:'image',label:'图片',tool:'search_images',hint:''},
 {id:'web',label:'网页',tool:'search_web',hint:''},
 {id:'report',label:'研究报告',tool:'search_web',hint:'研究报告 research report'},
 {id:'case',label:'案例研究',tool:'search_web',hint:'案例研究 case study'},
 {id:'news',label:'新闻资讯',tool:'search_web',hint:'新闻 news'},
 {id:'data',label:'数据 / 统计',tool:'search_web',hint:'数据集 统计 dataset statistics'},
 {id:'patent',label:'专利',tool:'search_web',hint:'专利 patent'},
 {id:'standard',label:'标准 / 规范',tool:'search_web',hint:'标准 规范 standard specification'},
 {id:'book',label:'书籍 / 文献',tool:'search_web',hint:'书籍 book bibliography'},
 {id:'tutorial',label:'教程 / 技术文档',tool:'search_web',hint:'教程 官方文档 documentation tutorial'},
 {id:'video',label:'视频 / 演讲',tool:'search_web',hint:'视频 演讲 video lecture'}
];
export const materialList=ids=>MATERIALS.filter(m=>ids.includes(m.id));
